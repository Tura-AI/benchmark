Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement an atomic JSON document store

## Context

The working directory contains the `relaykit` Python package. Add crash-safe JSON persistence with optimistic revisions, backups, and transactional updates.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- write() must use a same-directory temporary file, flush it, and atomically replace the target without leaving temporary files.
- Every document carries a monotonically increasing integer `_revision`; expected_revision mismatches raise StoreConflictError.
- update(callback) performs a locked read-modify-write operation and returns an isolated copy.
- Detect malformed primary data, recover from a valid backup when possible, and otherwise raise StoreCorruptionError.
- Preserve this public call shape: `AtomicJSONStore(path); read() -> dict; write(document, expected_revision=None) -> dict; update(callback, expected_revision=None) -> dict`.

## Public API and compatibility

- Implement the feature in `relaykit/store.py`.
- Export `AtomicJSONStore`, `StoreConflictError`, `StoreCorruptionError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
