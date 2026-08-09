Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add a cancellation-safe async worker pool

## Context

The working directory contains the `relaykit` Python package. Implement bounded asynchronous mapping with ordered results and explicit failure semantics.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Never run more than limit operations simultaneously and preserve input order in returned WorkResult objects.
- In collect mode, record per-item values or exceptions and continue processing all work.
- In fail-fast mode, cancel outstanding work, await cleanup, and re-raise the first failure.
- Caller cancellation must propagate and leave no orphan tasks; support synchronous or asynchronous worker functions.
- Preserve this public call shape: `await map_concurrent(func, items, *, limit, fail_fast=False) -> list[WorkResult]; WorkResult has index, item, value, error`.

## Public API and compatibility

- Implement the feature in `relaykit/worker.py`.
- Export `map_concurrent`, `WorkResult` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
