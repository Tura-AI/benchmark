# MCP benchmark tasks and workflow harness

Tura Benchmark contains two complementary MCP task suites. Both exercise real
MCP JSON-RPC over stdio while keeping external service state deterministic and
run-scoped. The agent must discover tools through `tools/list`, call them
through `tools/call`, and produce the required state transitions. Scoring is
implemented entirely in code; no LLM judge or human rating is required.

## Suites

### Repository-style MCP tasks

The 20 tasks under `tasks/mcp/` are derived from MCPMark filesystem scenarios
and packaged as independent benchmark tasks:

- async worker pool
- atomic JSON store
- checkpoint pipeline
- circuit breaker
- configuration precedence
- cron schedule engine
- dependency graph planner
- hash-chained audit log
- JSON diff and patch
- ordered batch executor
- plugin dependency loader
- priority event bus
- recursive secret redaction
- retry policy
- safe query language
- schema migration registry
- signed cursor pagination
- targeted feature flags
- token bucket limiter
- TTL/LRU cache

The source snapshot lives under `mcpmark/` and is based on upstream MCPMark
commit `cd45b7f57923b9b3985467f5139927575f83141c`. It includes the filesystem
state-manager changes, fixtures, and scripts used by this repository. Benchmark
task contracts, runners, and agent adapters remain under `tasks/mcp/` so each
task can be selected and scored independently.

### Stateful MCP workflow tasks

The 10 tasks under `tasks/mcp_workflow/` model multi-step interactions across
vendor-aligned service contracts:

| Task                                 | Workflow                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-campaign-image-email`      | Read a Drive campaign brief, edit and export an image through the Photoshop adapter, then create a Gmail draft containing the artifact URL. |
| `workflow-contract-signature`        | Retrieve a contract, prepare a signature request, and record the resulting document and notification state.                                 |
| `workflow-customer-onboarding`       | Assemble onboarding material across workspace services and create the required customer communication.                                      |
| `workflow-ecommerce-ad-package`      | Build an e-commerce advertising package from source assets and publish its delivery state.                                                  |
| `workflow-event-promo-kit`           | Produce coordinated event image/video assets and prepare the campaign communication.                                                        |
| `workflow-incident-response`         | Collect incident data, update the response workflow, and notify the responsible channel.                                                    |
| `workflow-invoice-email-followup`    | Locate invoice correspondence, update the follow-up state, and create the required Gmail draft.                                             |
| `workflow-product-demo-video`        | Process a product demo video, publish its artifact, and prepare delivery.                                                                   |
| `workflow-recruiting-interview-pack` | Gather candidate material, create the interview package, and schedule or communicate the next step.                                         |
| `workflow-social-thumbnail-approval` | Inspect media metadata, create the approval thumbnail, and route it through the approval workflow.                                          |

These are mock services, not live Google, Adobe, Slack, or signing accounts.
Their tool names, required parameters, response shapes, documented limitations,
and errors follow the referenced official MCP or vendor API contracts wherever
an official contract exists. State mutations and generated artifact URLs are
deterministic and isolated to the current benchmark run.

Gmail workflow tasks create drafts rather than sending mail. The mock enforces
the same published restriction used by the task contract: draft attachments are
not accepted, so generated artifact URLs must be placed in the draft body.

## Task-local contracts

Every workflow directory contains:

- `benchmark.task.json`: executable benchmark declaration;
- `task.json` and `harness.json`: normalized task and scoring contracts;
- `scenario.json`: tool schemas, initial state, required calls, dependency
  order, and expected final state;
- `mcp_server.py`: task-local MCP stdio entrypoint;
- `verify.py`: independent final-state verifier;
- `runner.mjs`: isolated execution and artifact orchestration;
- `adapters/codex/config.toml`: Codex MCP server registration;
- `adapters/tura-command/command.toml`: Tura external-command registration;
- `adapters/manifest.json`: shared server command, arguments, tools, and vendor
  contract provenance.

Adapter files are generated deterministically:

```sh
npm run mcp:adapters
npm run mcp:workflow:generate
```

## Codex and Tura compatibility

Codex starts each task's Python MCP server directly from the generated
`[mcp_servers.*]` TOML entry. Tura exposes the same server through the
`mcp_workspace` command and the Rust stdio bridge. The bridge performs one
complete MCP interaction for each external-command call:

```text
initialize -> notifications/initialized -> tools/list -> tools/call
```

Build and self-test the Tura bridge with:

```sh
npm run mcp:tura-bridge:build
npm run mcp:tura-bridge:selftest
```

The generated bridge binary under `target/` is a local build artifact and is
not published. Its source and lockfile live under
`tools/tura-command-mcp-stdio-bridge/`.

## Planning and execution

Use the standard benchmark CLI. A plan is read-only and does not launch an
agent:

```sh
node scripts/benchmark.mjs plan \
  --task workflow-campaign-image-email \
  --agents balanced,direct,codex-cli \
  --replicates 3 \
  --concurrency 9
```

Live execution requires either a frozen cohort contract or the explicit pilot
flag. For an exploratory run:

```sh
node scripts/benchmark.mjs run \
  --pilot \
  --task workflow-campaign-image-email \
  --agents balanced,direct,codex-cli \
  --replicates 3 \
  --concurrency 9
```

Each agent's concurrency is controlled by the job matrix and the global
`--concurrency` value. Three agents, three replicates, and ten tasks produce 90
jobs; `--concurrency 9` allows up to nine jobs to be active at once.

## Harness behavior

The workflow harness evaluates five deterministic checks:

1. the MCP initialize handshake completed;
2. the agent discovered all task tools through `tools/list`;
3. every required tool operation completed successfully;
4. successful calls respected the workflow dependency graph;
5. the independent verifier confirmed final remote state and artifacts.

The mock server validates each call as it happens. Invalid parameters, missing
dependencies, unsupported attachment behavior, unknown identifiers, and other
contract violations are returned immediately as MCP tool errors so the agent
can recover during the run. Recoverable failed attempts remain in the trace but
do not invalidate a subsequently completed workflow.

After execution, the harness writes normalized contracts under
`metadata/contracts/`, including `harness-report.json` and `task-report.json`.
MCP protocol events and state are written to `mcp/trace.jsonl` and
`mcp/state.json`. Batch summaries and cohort contracts stay under the ignored
`raw/` tree.

## Results publication

Completed batches can be converted into a schema-validated results manifest:

```sh
node scripts/publish_mcp_workflow_batch.mjs \
  --raw-root raw/<batch-directory> \
  --output results/mcp/report-mcp-workflow-<name>/manifest.json
```

The publisher reconstructs cache usage from per-round provider records,
preserves reasoning tokens as an output subset, aggregates results by agent and
task, records failed harness checks, and estimates API-equivalent token cost.
It also creates a self-contained result tree for every run:

```text
results/mcp/report-mcp-workflow-<name>/runs/<run-id>/
  task.json
  workspace/
  agent/rounds/*.json
  agent/agent-rounds.jsonl
  agent/context-and-calls/provider-calls-full.jsonl
  metadata/contracts/
  mcp/trace.jsonl
  mcp/state.json
  harness/
  result.json
```

The round records preserve model input, model output, token usage, commands,
tool calls, and source references. The MCP trace preserves the complete
normalized JSON-RPC `initialize`, `tools/list`, and `tools/call` requests and
responses. Published
workspaces contain the task-visible repository state but exclude `.git`
metadata and `.tura` runtime databases; the normalized agent records provide
the execution history separately without local absolute paths. The ignored
`raw/` source batch remains unchanged.

The output follows `schema/mcp-workflow-batch.schema.json` and is included in
the repository-wide schema validation.

The published GPT-5.6 Sol Low batch contains 90 runs across the ten workflow
tasks, three agents, and three replicates. Its manifest is available at
`results/mcp/report-mcp-workflow-gpt56-sol-low-20260809/manifest.json`.

## Validation

Run the focused MCP tests and the complete schema check before publication:

```sh
node --test tests/mcp_tasks.test.mjs tests/mcp_workflow_tasks.test.mjs \
  tests/mcp_workflow_results.test.mjs tests/mcp_stdio_broker.test.mjs \
  tests/benchmark_result.test.mjs
npm run schema:check
```

The full repository quality gate remains `npm run check`.
