Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Add signed keyset pagination cursors

## Context

The working directory contains the `relaykit` Python package. Provide tamper-evident opaque cursors and stable keyset pagination for ordered records.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- CursorCodec(secret).encode(payload) must produce a URL-safe opaque string and decode() must recover the JSON-compatible payload.
- Reject malformed, modified, or wrong-secret cursors with CursorError.
- paginate(items, limit, cursor, key, codec) must return (page, next_cursor), never duplicate items, and use the keyset rather than an array offset.
- Support compound keys and deterministic ordering when multiple records share the first key component.
- Preserve this public call shape: `CursorCodec(secret).encode(payload), CursorCodec.decode(token), paginate(items, *, limit, cursor=None, key, codec) -> (page, next_cursor)`.

## Public API and compatibility

- Implement the feature in `relaykit/cursor.py`.
- Export `CursorCodec`, `paginate` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
