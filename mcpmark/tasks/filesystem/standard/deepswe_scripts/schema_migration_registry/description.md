Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add reversible schema migrations

## Context

The working directory contains the `relaykit` Python package. Implement deterministic forward and backward migration of versioned dictionary documents.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Register exactly one up and down migration for consecutive integer versions and reject gaps or duplicates.
- migrate(document, target) must apply every required step on a deep copy and update the integer `_schema_version` after each successful step.
- Support downgrades, no-op migrations, and rollback to the original document when a step raises.
- Expose plan(current, target) and reject unreachable or invalid versions with MigrationError.
- Preserve this public call shape: `MigrationRegistry.register(from_version, up, down); plan(current, target) -> list[tuple[int, int]]; migrate(document, target) -> dict`.

## Public API and compatibility

- Implement the feature in `relaykit/migrations.py`.
- Export `MigrationRegistry`, `MigrationError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
