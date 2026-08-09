Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement plugin discovery and dependency loading

## Context

The working directory contains the `relaykit` Python package. Load Python plugins from manifests with dependency ordering, version checks, and rollback.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Discover plugin.json manifests with name, semantic version, `file.py:function` entrypoint, and a dependency mapping of plugin names to constraints; reject duplicates and malformed fields.
- Resolve dependencies in stable topological order and enforce simple >=, ==, and < version constraints.
- Import each entrypoint and call register(registry); if any plugin fails, undo registrations from that load operation.
- Report missing dependencies and cycles through PluginError with actionable plugin names.
- Preserve this public call shape: `PluginLoader(paths).discover() -> dict; load(registry) -> list[str]`.

## Public API and compatibility

- Implement the feature in `relaykit/plugins.py`.
- Export `PluginLoader`, `PluginError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.

## MCP execution constraint

Use the `tura_filesystem` MCP server to inspect and change workspace files. All file mutations must go through its MCP tools. You may use the shell only to execute tests; do not use shell commands or built-in patch tools to read, create, overwrite, rename, or delete workspace files.
