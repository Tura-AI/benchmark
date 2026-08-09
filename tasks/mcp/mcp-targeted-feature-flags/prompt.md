Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add deterministic targeted feature flags

## Context

The working directory contains the `relaykit` Python package. Evaluate boolean and multivariate flags using ordered targeting rules and stable percentage rollout.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Definitions use `default`, optional ordered `rules` entries (`when` plus `value`), and optional `rollout` entries (`value` plus percentage). Conditions support eq, in, gt/gte/lt/lte and all/any groups over dotted context attributes.
- The first matching rule wins; otherwise use percentage rollout or the declared default.
- Percentage assignment is stable across processes using a cryptographic hash of flag key, identity, and salt.
- Validate rollout totals and variants, return an evaluation reason, and never mutate flag definitions or context.
- Preserve this public call shape: `FeatureFlagEngine(definitions, *, salt=''); evaluate(flag_key, context, *, identity=None) -> Evaluation(value, reason, rule_index)`.

## Public API and compatibility

- Implement the feature in `relaykit/flags.py`.
- Export `FeatureFlagEngine`, `FlagConfigError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
