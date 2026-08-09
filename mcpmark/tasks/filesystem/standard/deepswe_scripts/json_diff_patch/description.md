Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add JSON diff, patch, and reversal

## Context

The working directory contains the `relaykit` Python package. Implement deterministic RFC-6901-style paths and reversible add/remove/replace operations.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- diff(source, target) returns deterministic add, remove, and replace operations for nested dictionaries and lists.
- Escape ~ and / in path segments and address list positions correctly as earlier operations change lengths.
- apply_patch works on a deep copy by default, validates paths and indices, and supports root replacement.
- reverse_patch(source, operations) produces operations that restore the exact source after the forward patch.
- Preserve this public call shape: `diff(source, target) -> list[dict]; apply_patch(document, operations, *, in_place=False); reverse_patch(source, operations) -> list[dict]`.

## Public API and compatibility

- Implement the feature in `relaykit/jsonpatch.py`.
- Export `diff`, `apply_patch`, `reverse_patch`, `PatchError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
