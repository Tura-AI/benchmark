Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add an ordered batch executor

## Context

The working directory contains the `relaykit` Python package. Implement lazy batching plus bounded async batch execution with per-item accounting.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- batch_iter accepts any iterable, validates size, is lazy, and emits a final partial tuple.
- batch_map invokes a sync or async batch function with bounded concurrency while preserving global input order.
- A batch function may return values or per-item exceptions; normalize both into BatchResult entries.
- Each BatchResult exposes index, item, value, and error fields.
- Detect result-length mismatches, support collect and fail-fast modes, and clean up outstanding work on cancellation.
- Preserve this public call shape: `batch_iter(iterable, size) -> iterator[tuple]; await batch_map(func, items, *, batch_size, concurrency=1, fail_fast=False) -> list[BatchResult]`.

## Public API and compatibility

- Implement the feature in `relaykit/batch.py`.
- Export `batch_iter`, `batch_map`, `BatchResult` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
