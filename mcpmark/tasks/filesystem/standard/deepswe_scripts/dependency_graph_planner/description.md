Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement dependency graph planning

## Context

The working directory contains the `relaykit` Python package. Add deterministic dependency ordering, parallel layers, subset closure, and actionable cycle errors.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Register named nodes with dependencies and reject references to missing nodes during validation or planning.
- order() returns a stable topological order; layers() groups nodes that can run in parallel.
- Planning a selected subset automatically includes its transitive dependencies.
- Cycles raise DependencyCycleError containing a concrete closed cycle path.
- Preserve this public call shape: `DependencyGraph.add(name, dependencies=()); validate(); order(selected=None) -> list[str]; layers(selected=None) -> list[list[str]]`.

## Public API and compatibility

- Implement the feature in `relaykit/graph.py`.
- Export `DependencyGraph`, `DependencyCycleError`, `UnknownDependencyError` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
