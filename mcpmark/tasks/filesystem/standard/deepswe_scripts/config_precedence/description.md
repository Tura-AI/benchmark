Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add layered configuration resolution

## Context

The working directory contains the `relaykit` Python package. Implement deterministic merging of defaults, config-file values, environment variables, and CLI overrides.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Apply precedence in the order defaults < file < environment < CLI without mutating any input mapping.
- Translate environment keys with the configured prefix into lower-case dotted keys, using double underscores as nesting separators.
- Coerce environment strings to the existing value type for booleans, integers, floats, lists, and null values; reject invalid coercions with ConfigError.
- Return a nested dictionary and preserve unknown file or CLI keys.
- Preserve this public call shape: `resolve_config(defaults, file_values=None, env=None, cli=None, *, env_prefix='RELAY_') -> dict`.

## Public API and compatibility

- Implement the feature in `relaykit/config.py`.
- Export `resolve_config`, `ConfigError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
