Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement a safe structured query language

## Context

The working directory contains the `relaykit` Python package. Parse a small query language into a reusable predicate without eval or arbitrary code execution.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Support dotted fields, strings, numbers, booleans, null, comparisons, in/not in, contains, and parentheses.
- Support case-insensitive AND, OR, and NOT with conventional precedence.
- Missing fields evaluate safely rather than raising, and numeric comparisons never coerce unrelated strings.
- Reject trailing tokens, function calls, attribute execution, and malformed literals with QuerySyntaxError.
- Preserve this public call shape: `compile_query(expression) -> callable(record) -> bool`.

## Public API and compatibility

- Implement the feature in `relaykit/query.py`.
- Export `compile_query`, `QuerySyntaxError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
