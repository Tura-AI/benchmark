Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement a concurrent circuit breaker

## Context

The working directory contains the `relaykit` Python package. Add closed, open, and half-open state transitions with deterministic timing and concurrency control.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Open after the configured consecutive failure threshold and reject calls while the reset timeout has not elapsed.
- Allow only the configured number of half-open probes; success closes the breaker and failure reopens it.
- Ignore excluded exception types, expose state and counters, and support explicit reset().
- Provide matching call() and call_async() behavior using an injectable monotonic clock.
- Preserve this public call shape: `CircuitBreaker(failure_threshold, reset_timeout, *, half_open_max_calls=1, excluded_exceptions=(), clock=None); call(func, *args, **kwargs); await call_async(...); reset(); snapshot()`.

## Public API and compatibility

- Implement the feature in `relaykit/circuit.py`.
- Export `CircuitBreaker`, `CircuitOpenError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
