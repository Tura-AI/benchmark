Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add recursive structured-data redaction

## Context

The working directory contains the `relaykit` Python package. Implement non-mutating secret redaction across nested objects and free-form strings.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Redact mapping values whose keys match configured names case-insensitively, including nested dictionaries and sequences.
- Redact bearer tokens, common API-key assignments, and URL credentials inside strings while preserving surrounding text.
- Handle dataclasses and cycles without infinite recursion, and preserve ordinary scalar types.
- Allow a custom replacement and additional key or regex rules.
- Preserve this public call shape: `Redactor(keys=None, patterns=None, replacement='[REDACTED]'); redact(value) -> deep-copied value`.

## Public API and compatibility

- Implement the feature in `relaykit/redaction.py`.
- Export `Redactor` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
