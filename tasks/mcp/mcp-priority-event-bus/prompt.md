Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add a priority-aware event bus

## Context

The working directory contains the `relaykit` Python package. Implement deterministic synchronous and asynchronous event dispatch with safe subscription mutation.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Subscriptions have priority and insertion order; higher priority handlers run first and ties remain stable.
- Support once-only subscriptions, token-based unsubscribe, wildcard subscriptions, and both sync and async handlers.
- Named handlers receive payload; wildcard '*' handlers receive (event_name, payload). emit returns handler results in dispatch order.
- Changes made while emitting affect only later emissions.
- Collect handler failures and raise one EventDispatchError after remaining handlers have run.
- Preserve this public call shape: `EventBus.subscribe(event, handler, *, priority=0, once=False) -> token; unsubscribe(token) -> bool; emit(event, payload=None) -> list; await emit_async(event, payload=None) -> list`.

## Public API and compatibility

- Implement the feature in `relaykit/events.py`.
- Export `EventBus`, `EventDispatchError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
