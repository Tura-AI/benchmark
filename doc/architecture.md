# Benchmark Framework Architecture

## Goal

Every published benchmark must be reproducible from a clean checkout without
machine-specific paths or agent-specific orchestration code. Task data,
execution code, agent configuration, local run state, and published evidence
therefore have separate ownership boundaries. The checked-in `results/` tree is
the compatibility oracle for schemas and artifact layout.

## Architecture layers

The framework has four layers:

1. **Task data** under `tasks/` defines prompts, source revisions, harnesses,
   evaluation modes, and task-local runner declarations.
2. **Reusable execution code** under `src/` and `lib/` handles preparation,
   agent invocation, parsing, monitoring, contracts, and harness reporting.
3. **Configuration and entry points** under `config/`, `scripts/`, and task-local
   `runner.mjs` files resolve portable settings and launch work.
4. **Artifacts** under `raw/` and `results/` separate local execution state from
   publishable verification evidence.

## Repository layout

```text
benchmark/
|-- config/                 Portable runtime and agent configuration
|-- deep_swe/               DeepSWE selection and matrix execution
|-- doc/                    Architecture, methodology, and evidence records
|-- lib/                    Reusable JavaScript runtime modules
|-- results/                Published compatibility and verification artifacts
|-- schema/                 Artifact schemas and validators
|-- scripts/                Public CLI and repository-level utilities
|-- src/                    Typed contracts and shared TypeScript code
|-- tasks/                  Stable benchmark definitions and task-local runners
|-- tests/                  Shared framework and contract tests
|-- raw/                    Ignored local runs, caches, logs, and workspaces
|-- package.json            Setup, validation, and dependency commands
|-- requirements.txt        Pinned Python validation dependencies
`-- tsconfig.json           TypeScript build boundary
```

Generated `dist/` and `raw/` directories are local artifacts. Published,
reproducible artifacts under `results/` are tracked and define the compatibility
standard.

## Stable boundaries

1. `tasks/` contains portable task definitions and harness inputs.
2. `config/agents.json` contains agent launch profiles. Agent IDs are data, not
   a TypeScript enum or a matrix-script constant.
3. `config/benchmark.json` contains portable runtime defaults and matrices.
4. `scripts/benchmark.mjs` is the public `list`, `plan`, `run`, and `validate`
   CLI.
5. `raw/` contains local execution state. `results/` contains complete,
   publishable verification artifacts and is never ignored.
6. `schema/validate.py` discovers artifacts from the current `results/` layout
   and validates recognized contracts without relying on a developer path.
7. Executable suites such as DeepSWE have one checked-in task declaration and a
   thin adapter. The adapter owns portable cache and run paths, then delegates
   execution to the suite runner.

## Task directory contract

Each task owns a directory below `tasks/<type>/<task-id>/`. Two representations
may coexist:

- `benchmark.task.json` and `runner.mjs` describe an executable benchmark.
- `task.json`, `prompt.md`, and a task-local `README.md` describe a published
  design task. Harness-scored tasks additionally include `harness.json`.

An executable declaration must contain a stable ID and type, a repository-local
directory, output contract versions, and at least one task-local runner variant.
Runner paths must be relative, and the default variant must be unambiguous.

Published design tasks set `evaluation.mode` to `design` and must not define a
harness. Published harness results refer to stable score-item IDs from
`harness.json`. Evidence must come from actual harness output; missing evidence
stays empty and must not be synthesized.

## Configuration

For every configurable value, precedence is:

1. explicit CLI option;
2. documented `TURA_BENCHMARK_*` environment variable;
3. selected JSON configuration file;
4. portable default derived from the repository root.

Use `TURA_BENCHMARK_CONFIG` to select another runtime configuration and
`TURA_BENCHMARK_AGENT_CONFIG` to select another agent configuration. Agent
commands, models, arguments, environment templates, task selection, replicas,
concurrency, timeouts, and output roots must remain configurable. Secrets never
belong in JSON configuration.

Tura runtime IDs are `balanced`, `direct`, and `direct-text-only`, matching the
runtime's agent IDs. Other CLIs use IDs declared in `config/agents.json`, such
as `codex-cli`. Planning is an execution operation, not an agent ID.

## Execution and data flow

The public CLI resolves a task declaration and agent profiles, then either
prints a dry-run plan or invokes the declared runner with normalized environment
variables. Live execution is explicit because it may consume paid provider,
network, or container resources.

- Configuration describes how an agent CLI is launched; task files describe
  what is evaluated. Machine-specific paths belong in neither contract.
- Preparation creates or copies the workspace and records its initial state.
- Parsing normalizes provider-specific callbacks into shared round and tool-call
  records without guessing unavailable usage data.
- CLI adapters return every observable round as a normalized contract and
  persist the same objects as per-round JSON and a JSONL stream. Tool details
  and per-round token usage remain attached to the round that produced them.
- Monitoring owns cumulative usage, event persistence, repository diffs, and
  the final task report.
- Harness execution is independent of agent launch and writes a normalized
  score report.
- Generated outputs belong under ignored artifact directories, never beside
  reusable source modules.

`TURA_BENCHMARK_RAW_ROOT` is the canonical raw-artifact root for executable
benchmarks. When unset, runners use `~/Documents/tura-benchmark/raw`.
`COMMAND_RUN_BENCHMARK_RAW_ROOT` remains a compatibility alias. Task runners
must resolve run directories through `lib/business_paths.mjs` instead of
constructing another output root.

Source-port runs start Tura through the normal `tura_exec + tura_router` path.
Embedded Tura mode is prohibited because its `command_run` calls are not
router-owned; the runner rejects `COMMAND_RUN_AGENT_TURA_EMBEDDED=1` and never
adds `--embedded`.

Codex CLI archives preserve untouched `stdout.jsonl` evidence and also write
`codex-token-usage.normalized.jsonl` and `codex-token-usage-summary.json`.
Normalized usage is deduplicated by cumulative `total_usage`; summaries, round
contracts, and reports use unique cumulative states rather than summing repeated
update events.

## Artifact and compatibility contract

Published artifacts under `results/` are tracked compatibility data. Their
directory layout and schemas are part of the repository contract. New raw logs,
temporary workspaces, downloaded repositories, and provider state belong under
the ignored `raw/` or `.tura/` directories.

The compatibility suite validates existing debug, design, and rewrite result
families, including manifests, per-run metadata, contract JSON, JSONL rounds,
and design workspaces. New orchestration may add optional fields but must not
rename or relocate existing published artifacts.

Result directories and manifests describe benchmark subsets. A subset must not
be presented as the complete upstream benchmark or as representative beyond its
declared task population. Publication and comparison rules are defined in the
[benchmark methodology](benchmark-methodology.md); current four-configuration
evidence is recorded in the [test-set record](current-test-set-record.md).

## Maintenance rules

1. Preserve files under `tasks/` unless a task is explicitly retired.
2. Keep task-specific logic in its task directory; move only genuinely reusable
   code into `src/` or `lib/`.
3. Change contracts through the typed contract layer, updating the parser,
   writer, and tests together.
4. Keep runner entry points thin by composing shared preparation, collection,
   and harness functions.
5. Do not commit temporary matrix launchers, one-off repair scripts, generated
   audits, raw logs, or local result data.
6. Remove scripts that point to retired tasks and code referenced only by
   obsolete scripts or tests.
7. Preserve raw source evidence. Normalization may reshape data but must not
   invent commands, output, usage, assertions, or scores.
8. Keep secrets, credentials, absolute local paths, and downloaded executables
   out of tracked configuration and artifacts.
9. Keep live execution opt-in. Unit tests and type checks must not consume
   provider quota or require external benchmark repositories.
10. Update this document whenever directory structure or a contract boundary
    changes.

Statistical publication is configured by `config/analysis.json`. The three
`analysis:*` entry points consume that shared cohort, population, exclusion,
pricing, path, and artifact contract rather than maintaining independent
defaults. Generated CSV source paths are relative to the configured `resultsRoot`
so checked-in analysis artifacts remain portable.

## Quality gates

Before merging framework changes:

- validate every task declaration and task-local runner path;
- run the MJS and compiled TypeScript tests;
- run TypeScript static checks;
- validate schemas against published results;
- syntax-check executable MJS entry points;
- run formatting and dead-code checks;
- confirm generated and temporary files remain ignored;
- confirm the `tasks/` inventory was not removed or rewritten unintentionally.
- run `node --test tests/analysis_reports.test.mjs` after regenerating analysis
  assets to catch report-cohort, sample-count, source-path, pricing, and chart-set
  drift.

`npm run check` runs the repository's standard local gates. Live benchmark
execution is a separate validation step because it can use external resources
and incur cost.

## Installation boundary

`npm run setup` owns repository-local dependencies: it installs the lockfile
state with `npm ci`, creates `.venv`, and installs pinned packages from
`requirements.txt`. Python entry points resolve `PYTHON` first, then `.venv`,
then the system `python` compatibility fallback. This keeps validation and live
round-contract checks on the same interpreter after setup.

Git, Docker, and agent CLIs remain system dependencies. Setup must not install,
configure, authenticate, or start them. `npm run doctor` checks the local test
boundary. Run `node scripts/doctor.mjs --benchmark --agents=<ids>` to
additionally check the Docker daemon and only the agent executables selected for
a prospective live run. Provider authentication remains an explicit user
responsibility.
