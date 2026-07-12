# Benchmark Framework Architecture

## Goal

Make every published benchmark reproducible from a clean checkout without
machine-specific paths or agent-specific orchestration code. The checked-in
`results/` tree is the compatibility oracle for schemas and artifact layout.

## Stable boundaries

1. `tasks/` contains portable task definitions and harness inputs.
2. `config/agents.json` contains agent launch profiles; agent IDs are data, not
   a TypeScript enum or a matrix-script constant.
3. `config/benchmark.json` contains portable runtime defaults.
4. `scripts/benchmark.mjs` is the public CLI. Precedence is CLI option,
   environment variable, configuration file, then documented default.
5. `raw/` contains local execution state. `results/` contains complete,
   publishable verification artifacts and is never ignored.
6. `schema/validate.py` discovers artifacts from the current `results/` layout
   and validates every recognized contract without relying on a developer path.
7. Executable suites such as DeepSWE have one checked-in task declaration and a
   thin adapter. The adapter owns portable cache/run paths and delegates actual
   execution to the suite runner; matrix scripts never guess runner locations.

## Compatibility contract

The compatibility suite must validate the existing debug, design, and rewrite
result families, including manifests, per-run metadata, contract JSON, JSONL
rounds, and design workspaces. New orchestration may add optional fields but
must not rename or relocate existing published artifacts.

## Configuration precedence

For every configurable value:

1. explicit CLI flag;
2. documented environment variable;
3. selected JSON configuration file;
4. portable default derived from the repository root.

Secrets never belong in JSON configuration. Agent commands, models, arguments,
environment templates, task selection, replicas, concurrency, timeouts, and
output roots must be configurable.

## Execution model

The CLI resolves a task declaration, resolves agent profiles, prints a dry-run
plan by default when requested, and invokes the declared runner with normalized
environment variables. Live execution is explicit because it may consume paid
provider or container resources.

## Quality gates

The repository uses Prettier for formatting, Knip for dead-code detection,
TypeScript for static checks, Node's test runner for JavaScript and compiled
TypeScript tests, Python schema validation against published results, and
syntax checks for every executable module.
