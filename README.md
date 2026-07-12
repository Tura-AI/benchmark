# Tura Benchmark

Canonical repository: <https://github.com/Tura-AI/benchmark>

Primary maintainer: Yohji Sakamoto (<yohji.sakamoto@gmail.com>)

This repository is Tura's manual long-horizon evaluation subsystem. It
keeps benchmark definitions separate from product tests and separates stable
task data from reusable execution code, agent configuration, and generated run
artifacts.

Benchmarks may launch external processes, clone repositories, use network and
provider quota, and create large outputs. They are not part of GitHub CI or the
default workspace test command.

## Quick start

Requirements: Node.js 20 or newer and Python 3.11 or newer.

```sh
git clone https://github.com/Tura-AI/benchmark.git
cd benchmark
npm ci
node scripts/benchmark.mjs list
node scripts/benchmark.mjs validate
```

Inspect a run plan before launching any agent:

```sh
node scripts/benchmark.mjs plan --task eza --agents balanced,direct --replicates 2
```

Launch the same plan only after checking its agent, model, concurrency, paths,
and potential provider cost:

```sh
node scripts/benchmark.mjs run --task eza --agents balanced,direct --replicates 2
```

The public commands are:

- `list`: print available tasks and configured agent profiles;
- `plan`: print the resolved jobs and environment without launching agents;
- `run`: execute the resolved jobs with bounded concurrency;
- `validate`: validate configuration and task declarations without a live run.

## Re-run DeepSWE v1.1

The DeepSWE entry point is declared at
`tasks/debug/deep-swe-v1.1/benchmark.task.json`; it does not depend on a
machine-specific runner path. Start with the cost-free plan:

```sh
npm run benchmark:deep-swe -- --agents balanced
```

After reviewing the paths, agent and provider cost, launch the default Tura
job with the explicit live script:

```sh
npm run benchmark:deep-swe:run
```

`balanced` is the script default, so `npm run benchmark:deep-swe` alone is a
safe plan. For overrides, call the public entry point directly; passing several
agents creates one isolated run directory per agent:

```sh
node scripts/run_debug_matrix.mjs --run --agents balanced,direct --run-id my-rerun
```

On the first live run, the adapter performs a filtered checkout of the pinned
`datacurve-ai/deep-swe` revision under `raw/_cache/deep-swe`, creates the
selection file, and then invokes `deep_swe/run_matrix.mjs`. Later runs reuse
that checkout and Docker's image cache. Configure the repository/revision and
task-directory layout in `config/benchmark.json`; use `DEEP_SWE_TASKS_ROOT` to
point directly at an existing task corpus or `DEEP_SWE_SELECTION` to reuse a
selection.
Set `DEEP_SWE_PREPARE_ONLY=1` through `--env` to verify the pinned checkout and
selection generation without launching Docker or an agent.

Live requirements are Docker, Git, Python 3.11+, and the selected agent CLI on
`PATH` (or its documented `COMMAND_RUN_AGENT_*_EXE` override). Provider login
remains outside tracked configuration. Tura jobs are always launched through
the Bash command surface (`tura exec bash --json`) and route repository shell
commands into the task container.

## Configuration

Runtime defaults and matrices live in `config/benchmark.json`. Agent commands,
models, environment overrides, and formal runtime IDs live in
`config/agents.json`. Do not encode a machine path, model, or agent matrix in a
task runner.

Settings use this precedence, from highest to lowest:

1. CLI options such as `--config`, `--agents`, `--concurrency`, and `--model`;
2. `TURA_BENCHMARK_*` environment variables;
3. the selected JSON configuration file;
4. repository defaults.

Use `TURA_BENCHMARK_CONFIG` to select another runtime configuration and
`TURA_BENCHMARK_AGENT_CONFIG` to select another agent configuration. Run
`node scripts/benchmark.mjs help` for the complete option and environment list.

Tura's accepted runtime agent IDs are exactly `balanced`, `direct`, and
`direct-text-only`, matching `tura agent list --json`. Planning is a separate
runtime option; it is not part of an agent ID. Other CLIs use the IDs declared
in `config/agents.json`, such as `codex-cli`.

## Results and local artifacts

Published artifacts under `results/` are tracked compatibility data. Their
directory layout and schemas are part of the repository contract. New raw logs,
temporary workspaces, downloaded repositories, and provider state belong under
the ignored `raw/` or `.tura/` directories, not under `results/`.

All benchmark task, harness, and published artifact links use the canonical
repository `https://github.com/Tura-AI/benchmark`. Tura CLI release and runtime
metadata intentionally use `https://github.com/Tura-AI/tura`; those links refer
to the CLI itself, not to benchmark source code.

### Result-reporting discipline

Result directories and manifests describe benchmark **subsets**. A subset is a
fixed, disclosed selection of tasks; it must not be presented as the complete
upstream benchmark or as a representative estimate beyond its declared task
set.

Published and compared results must follow the
[Tura benchmark methodology](https://github.com/Tura-AI/tura/blob/main/docs/benchmark/benchmark-methodology.md):

- freeze and identify the benchmark revision, subset selection, task matrix,
  agent and model configuration, effort, timeout, replicate count, and execution
  period before interpreting results;
- retain every valid task outcome, including failures; replicates are
  independent observations, and a run may be replaced only when a documented
  infrastructure failure made it invalid;
- preserve raw events, normalized records, verifier output, repository diffs,
  and retry lineage; never infer or manufacture missing evidence, usage, or
  scores;
- report DeepSWE, rebuild, and design subsets separately, keep non-harness
  design results outside harness aggregates, and disclose any optional aggregate
  formula before use;
- publish counts and denominators with every rate, disclose exclusions, reruns,
  harness revisions, and manual judgments, and report uncertainty for repeated
  outcomes; and
- compare runs only when task and harness revisions, model and effort settings,
  timeout and network policies, and replicate counts are compatible. Otherwise,
  label the comparison as non-equivalent rather than implying a ranking.

## Quality gates

```sh
npm run format
npm run check
```

`npm run check` runs formatting, TypeScript checks, all local tests, schema
validation against published results, benchmark-link auditing, and Knip dead
code analysis. It does not launch a live agent or consume provider quota.

## License

This repository is licensed under the [MIT License](LICENSE).

## Architecture

The benchmark subsystem is organized into four layers:

1. **Task layer** — owns task identity, instructions, runner entry points, and
   scoring contracts.
2. **Contract layer** — defines the normalized metadata, round, report, and
   harness shapes shared by all runners.
3. **Runtime layer** — prepares isolated workspaces, launches a configured CLI,
   records events and usage, captures repository changes, and invokes scoring.
4. **Artifact layer** — stores local run data and generated reports outside the
   source tree tracked by Git.

```text
task declaration
      │
      ▼
workspace preparation ──► agent launch ──► round/event collection
                                                │
                                                ▼
                                  repository diff + task report
                                                │
                                                ▼
                                         scoring harness
```

The TypeScript modules are the stable contract and orchestration API. The MJS
modules are the compatibility runtime used by task-local runners. A file in
`lib/` can therefore be live even when it is not imported from `src/`.

## Directory design

```text
./
├── config/
│   └── agents.json        Editable CLI profile and launch defaults
├── lib/                   Runtime compatibility helpers used by runners
├── src/
│   ├── agents.ts          Profile loading and launch configuration
│   ├── contracts.ts       Shared schemas and TypeScript data contracts
│   ├── declaration.ts     Task discovery and declaration validation
│   ├── harness.ts         Scoring execution and report writing
│   ├── io.ts              Deterministic JSON/text filesystem helpers
│   ├── monitor.ts         Round, usage, diff, and report collection
│   ├── parser.ts          Instruction, event, and tool-call normalization
│   └── preparer.ts        Workspace preparation and process launch
├── tasks/
│   ├── build/             Functional implementation tasks
│   ├── design/            Visual and interactive artifact tasks without harnesses
│   ├── debug/             Diagnosis and repair tasks
│   └── rewrite/           Rebuild, port, and compatibility tasks
├── tests/                 Tests for shared benchmark code and contracts
├── scripts/benchmark.mjs  Public list, plan, run, and validate CLI
└── tsconfig.json          TypeScript build boundary
```

Empty task-type directories do not need to exist. Generated `dist/` and `raw/`
directories are local artifacts. Published, reproducible artifacts under
`results/` are tracked and define the compatibility standard.

## Task directory contract

Each task owns a directory below `tasks/<type>/<task-id>/`. Two representations
may coexist:

- `benchmark.task.json` and `runner.mjs` describe an executable benchmark.
- `task.json`, `prompt.md`, and a task-local `README.md` describe a published
  design task. Harness-scored tasks additionally include `harness.json`.

An executable declaration must contain a stable id and type, a repository-local
directory, output contract versions, and at least one task-local runner variant.
Runner paths must be relative. A default variant must be unambiguous.

Published design tasks set `evaluation.mode` to `design` and must not define a
harness. Published harness results refer to stable score-item ids from `harness.json`.
Evidence must come from the actual harness output; missing evidence stays empty
and must not be synthesized.

## Data flow and boundaries

- Configuration describes how a CLI is launched; task files describe what is
  evaluated. Do not mix machine-specific paths into either contract.
- Preparation creates or copies the workspace and records the initial state
  before the agent starts.
- Parsing normalizes provider-specific callbacks into shared round and tool-call
  records without guessing unavailable usage data.
- CLI adapters return every observable round as a normalized round contract and
  persist the same objects as per-round JSON plus a line-delimited JSONL
  stream. Tool execution details and per-round token usage remain attached to
  the round that produced them.
- Monitoring owns cumulative usage, event persistence, repository diffs, and
  the final task report.
- Harness execution is independent of the agent launch and writes a normalized
  score report.
- Generated outputs belong under ignored artifact directories, never beside
  reusable source modules.

`TURA_BENCHMARK_RAW_ROOT` is the canonical raw-artifact root for executable
benchmarks. When it is unset, runners use
`~/Documents/tura-benchmark/raw`. `COMMAND_RUN_BENCHMARK_RAW_ROOT` remains a
compatibility alias; task runners must resolve their run directories through
`lib/business_paths.mjs` rather than constructing another output
root.

Source-port benchmark runs must start Tura through the normal
`tura_exec + tura_router` path. Embedded Tura mode is prohibited because its
`command_run` calls are not router-owned; the runner rejects
`COMMAND_RUN_AGENT_TURA_EMBEDDED=1` and never adds `--embedded`.

Codex CLI archives preserve the untouched `stdout.jsonl` evidence and also
write `codex-token-usage.normalized.jsonl` plus
`codex-token-usage-summary.json`. Normalized usage is deduplicated by cumulative
`total_usage`; summaries, round contracts, and reports must use the unique
cumulative states rather than summing repeated update events.

## Maintenance rules

1. Preserve files under `tasks/` unless a task is explicitly retired.
2. Keep task-specific logic inside its task directory; move only genuinely
   reusable code into `src/` or `lib/`.
3. Add or change contracts through the typed contract layer and update the
   corresponding parser, writer, and tests together.
4. Keep runner entry points thin. They should compose shared preparation,
   collection, and harness functions instead of duplicating them.
5. Do not commit temporary matrix launchers, one-off migration or repair
   scripts, generated audits, reports, raw logs, or local result data.
6. Do not retain scripts that point to removed task directories or functions
   that are referenced only by obsolete scripts/tests.
7. Preserve raw source evidence. Normalization may reshape data but must not
   invent commands, output, usage, assertions, or scores.
8. Keep secrets, credentials, absolute local paths, and downloaded executables
   out of tracked configuration and artifacts.
9. Live benchmark execution stays opt-in. Unit tests and type checks must not
   consume provider quota or require external benchmark repositories.
10. When the directory structure or a contract boundary changes, update this
    document in the same change.

## Validation rules

Before merging benchmark framework changes:

- validate every task declaration and its task-local runner path;
- run the MJS unit tests with Node;
- run the TypeScript tests and compiler checks;
- syntax-check executable MJS entry points;
- confirm generated and temporary files remain ignored;
- confirm the `tasks/` inventory was not removed or rewritten unintentionally.

Live task execution is a separate, explicit validation step because it can use
external resources and incur cost.
