Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add a tamper-evident audit log

## Context

The working directory contains the `relaykit` Python package. Persist canonical JSON-lines audit events linked by cryptographic hashes.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- append(actor, action, data) writes one canonical JSON record containing sequence, timestamp, previous hash, and record hash.
- Use an injectable clock, flush and fsync writes, and continue a valid existing chain after reopening.
- verify() detects edited, removed, reordered, duplicated, or malformed records and raises AuditIntegrityError with the failing line.
- iter_records verifies by default and returns defensive copies of decoded records.
- Preserve this public call shape: `AuditLog(path, *, clock=None); append(actor, action, data) -> dict; verify() -> bool; iter_records(verify=True) -> iterator[dict]`.

## Public API and compatibility

- Implement the feature in `relaykit/audit.py`.
- Export `AuditLog`, `AuditIntegrityError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
