#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ensureGenericAgentExecutables,
  findCodexCliExe,
  genericAgentKind,
  genericAgentMode,
  priorityEnabled,
  runGenericAgentCli,
} from "../lib/generic_agent_cli.mjs";
import { projectPython } from "../lib/python_runtime.mjs";
import {
  HARNESS_CONCURRENCY,
  VERIFIER_COMMAND,
  buildHarnessBatches,
  validHarnessReport,
} from "./harness.mjs";
import { captureChangedWorkspace } from "../lib/debug_workspace_recovery.mjs";
import { costEstimateForUsage } from "../lib/business_paths.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const benchmarkConfig = readJson(
  path.resolve(
    process.env.TURA_BENCHMARK_CONFIG ||
      path.join(repoRoot, "config", "benchmark.json"),
  ),
);
const deepSweConfig = benchmarkConfig?.deepSwe || {};
try {
  process.loadEnvFile?.(path.join(repoRoot, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const runRoot = path.resolve(requiredEnv("DEEP_SWE_RUN_ROOT"));
const harnessCompletedOnly =
  process.env.DEEP_SWE_HARNESS_COMPLETED_ONLY === "1";
const tasksRoot = path.resolve(requiredEnv("DEEP_SWE_TASKS_ROOT"));
const selectionPath = path.resolve(
  process.env.DEEP_SWE_SELECTION || path.join(runRoot, "selection.json"),
);
const selection = readJson(selectionPath);
const runId = path.basename(runRoot);
const manifestPath = path.join(runRoot, "manifest.json");
const progressPath = path.join(runRoot, "PROGRESS.md");
const workspacesRoot = path.join(runRoot, "_workspaces");
const concurrency = positiveInteger(
  process.env.DEEP_SWE_CONCURRENCY || deepSweConfig.concurrency || 1,
  "DeepSWE concurrency",
);
const taskBatchSize = positiveInteger(
  process.env.DEEP_SWE_TASK_BATCH_SIZE || deepSweConfig.taskBatchSize || 1,
  "DeepSWE task batch size",
);
const monitorMs = positiveInteger(
  process.env.DEEP_SWE_MONITOR_MS || deepSweConfig.monitorMs || 120_000,
  "DeepSWE monitor interval",
);
const diskSafetyFloorGb = Number(
  process.env.DEEP_SWE_DISK_SAFETY_FLOOR_GB || 5,
);
const keepWorkspaces = truthy(process.env.DEEP_SWE_KEEP_WORKSPACES);
const turaExe =
  process.env.COMMAND_RUN_AGENT_TURA_EXE ||
  findCommand("tura") ||
  path.join(repoRoot, "target", "debug", executableName("tura_exec"));
const turaRouterExe =
  process.env.TURA_ROUTER_BIN ||
  path.join(repoRoot, "target", "debug", executableName("tura_router"));
const codexExe = findCodexCliExe(repoRoot);
const expectedCodexCliVersion = String(
  process.env.DEEP_SWE_CODEX_CLI_VERSION ||
    deepSweConfig.codexCliVersion ||
    "0.144.1",
);
const variants = parseVariants(
  process.env.DEEP_SWE_VARIANTS,
  deepSweConfig.variants,
);
const expectedTaskCount = Number(
  process.env.DEEP_SWE_EXPECTED_TASK_COUNT ??
    deepSweConfig.expectedTaskCount ??
    0,
);

assert(
  selection?.schema === "tura.benchmark.deep-swe-selection.v1",
  `invalid selection: ${selectionPath}`,
);
assert(
  Array.isArray(selection.tasks) && selection.tasks.length > 0,
  `selection must contain at least one task: ${selectionPath}`,
);
if (expectedTaskCount > 0)
  assert.equal(
    selection.tasks.length,
    expectedTaskCount,
    `selection must contain ${expectedTaskCount} tasks: ${selectionPath}`,
  );
assert.equal(
  selection.tasks.length % taskBatchSize,
  0,
  "DeepSWE task count must divide evenly into task batches",
);
assert.equal(
  concurrency,
  taskBatchSize * variants.length,
  "DeepSWE concurrency must equal taskBatchSize x configured variants",
);
const selectedAgentKinds = new Set(
  variants.map((variant) => genericAgentKind(variant.agent)),
);
if (selectedAgentKinds.has("tura"))
  assert(fs.existsSync(turaExe), `missing Tura executable: ${turaExe}`);
let codexCliVersion = null;
if (variants.some((variant) => variant.agent === "codex-cli")) {
  assert(codexExe, "missing codex-cli executable");
  const versionResult = spawnSync(codexExe, ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (versionResult.error) throw versionResult.error;
  assert.equal(versionResult.status, 0, "failed to read codex-cli version");
  codexCliVersion = String(versionResult.stdout || versionResult.stderr || "")
    .trim()
    .replace(/^codex-cli\s+/i, "");
  assert.equal(
    codexCliVersion,
    expectedCodexCliVersion,
    "DeepSWE Codex CLI version mismatch",
  );
}

delete process.env.COMMAND_RUN_AGENT_TURA_EMBEDDED;
delete process.env.COMMAND_RUN_AGENT_TURA_SANDBOX;
delete process.env.TURA_COMMAND_RUN_SANDBOX;
process.env.COMMAND_RUN_AGENT_TURA_SHELL = "bash";
process.env.COMMAND_RUN_AGENT_TURA_EXE = turaExe;
if (fs.existsSync(turaRouterExe)) process.env.TURA_ROUTER_BIN = turaRouterExe;
if (codexExe) process.env.COMMAND_RUN_AGENT_CODEX_CLI_EXE = codexExe;
ensureGenericAgentExecutables(
  [...new Set(variants.map((variant) => variant.agent))],
  { repoRoot, turaExe, codexCliExe: codexExe },
);

fs.mkdirSync(runRoot, { recursive: true });
fs.mkdirSync(workspacesRoot, { recursive: true });

const jobs = selection.tasks.flatMap((task, taskIndex) =>
  variants.map((variant) => ({
    key: `${task.task_id}__${variant.agent}__r${variant.replicate}`,
    taskIndex,
    batch_index: Math.floor(taskIndex / taskBatchSize) + 1,
    task,
    ...variant,
    state: "pending",
    phase: "pending",
    started_at: null,
    finished_at: null,
    exit_code: null,
    error: null,
    round_count: 0,
    tool_call_count: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    patch_bytes: 0,
    scheme_ok: null,
    docker_routing_ok: null,
    harness_state: "pending",
    harness_score: null,
    harness_error: null,
  })),
);

const parsedOldManifest = readJson(manifestPath, null);
const oldManifest = parsedOldManifest?.jobs
  ? parsedOldManifest
  : recoverManifestFromArtifacts();
if (oldManifest?.jobs) {
  const oldByKey = new Map(oldManifest.jobs.map((job) => [job.key, job]));
  for (const job of jobs) {
    const previous = oldByKey.get(job.key);
    if (!previous) continue;
    Object.assign(job, previous);
    const harnessReport = readJson(
      path.join(agentDirectory(job), "harness", "report.json"),
      null,
    );
    if (!validHarnessReport(harnessReport)) {
      job.harness_state = "pending";
      job.harness_score = null;
      job.harness_error = harnessReport
        ? `invalid verifier result: exit ${harnessReport.exit_code}`
        : null;
    }
    if (repairCodexDockerRoutingFalseNegative(job)) continue;
    if (repairContractValidTimeout(job)) continue;
    const summaryPath = agentSummaryPath(job);
    const patchPath = path.join(agentDirectory(job), "model.patch");
    if (
      job.state === "completed" &&
      (!fs.existsSync(patchPath) || fs.statSync(patchPath).size === 0)
    ) {
      job.state = "pending";
      job.phase = "resume-missing-patch";
      job.harness_state = "pending";
      job.harness_score = null;
    } else if (job.state === "completed" && !fs.existsSync(summaryPath)) {
      job.state = "pending";
      job.phase = "resume-missing-summary";
    } else if (job.state !== "completed") {
      // A stopped runner can leave jobs marked `running` even though their
      // worker process no longer exists. Normalize every unfinished job so
      // resumed manifests report only the six workers actually relaunched.
      job.state = "pending";
      job.phase = "resume-pending";
      job.worker = null;
    }
  }
}

const manifest = {
  schema: "tura.benchmark.deep-swe-matrix.v1",
  run_id: runId,
  run_root: runRoot,
  benchmark: "datacurve-ai/deep-swe",
  benchmark_version: "v1.1",
  selection_path: selectionPath,
  planned_agent_runs: jobs.length,
  planned_harness_runs: jobs.length,
  concurrency,
  task_batch_size: taskBatchSize,
  task_batch_count: selection.tasks.length / taskBatchSize,
  runs_per_task_batch: taskBatchSize * variants.length,
  task_batches_are_sequential: true,
  model: "gpt-5.6-sol",
  codex_cli_executable: codexExe,
  codex_cli_version: codexCliVersion,
  tura_model: "openai/gpt-5.6-sol",
  tura_reasoning: uniqueReasoning("tura"),
  codex_reasoning: uniqueReasoning("codex"),
  service_tier: "default",
  priority_enabled: false,
  tura_embedded: false,
  tura_sandbox: false,
  tura_shell: "bash",
  harness_after_all_agent_runs: true,
  disk_safety_floor_gb: diskSafetyFloorGb,
  keep_workspaces: keepWorkspaces,
  phase: oldManifest?.phase || "initializing",
  started_at: oldManifest?.started_at || new Date().toISOString(),
  finished_at: oldManifest?.finished_at || null,
  monitor_log: oldManifest?.monitor_log || [],
  stop_reason: oldManifest?.stop_reason || null,
  jobs,
};

const imagePromises = new Map();
const verifierImagePromises = new Map();
let stopped = false;
let monitorTimer = null;

await main();

async function main() {
  writeState("initializing");
  if (harnessCompletedOnly) {
    await runCompletedOnlyHarness();
    return;
  }
  manifest.phase = "agent-runs";
  writeState(
    `starting ${manifest.task_batch_count} sequential task batches; each batch has ${taskBatchSize} tasks x ${variants.length} replicates = ${manifest.runs_per_task_batch} concurrent runs`,
  );
  monitorTimer = setInterval(() => {
    recordMonitor(`scheduled ${Math.round(monitorMs / 1000)}-second monitor`);
    console.log(formatMonitorLine());
  }, monitorMs);
  monitorTimer.unref?.();

  await runAgentBatches();
  if (stopped || jobs.some((job) => job.state !== "completed")) {
    manifest.phase = "agent-runs-stopped";
    writeState(manifest.stop_reason || "agent matrix did not complete");
    process.exitCode = 1;
    return;
  }

  const missingPatches = jobs.filter((job) => {
    const patchPath = path.join(agentDirectory(job), "model.patch");
    return !fs.existsSync(patchPath) || fs.statSync(patchPath).size === 0;
  });
  if (missingPatches.length > 0) {
    manifest.phase = "patch-gate-failed";
    manifest.stop_reason = `missing non-empty patches: ${missingPatches.map((job) => job.key).join(", ")}`;
    writeState(manifest.stop_reason);
    process.exitCode = 1;
    return;
  }

  manifest.phase = "harness";
  writeState(
    `all ${jobs.length} agent runs have non-empty patches; starting official verifier one task image at a time with ${variants.length} variants in parallel`,
  );
  await runHarnessBatches();
  if (stopped || jobs.some((job) => job.harness_state !== "completed")) {
    manifest.phase = "harness-stopped";
    writeState(manifest.stop_reason || "harness matrix did not complete");
    process.exitCode = 1;
    return;
  }

  manifest.phase = "completed";
  manifest.finished_at = new Date().toISOString();
  writeState(
    `${jobs.length} agent runs and ${jobs.length} harness runs complete`,
  );
  if (monitorTimer) clearInterval(monitorTimer);
  console.log(`[deep-swe] complete manifest=${manifestPath}`);
}

async function runCompletedOnlyHarness() {
  const harnessJobs = jobs.filter((job) => job.state === "completed");
  const missingPatches = harnessJobs.filter((job) => {
    const patchPath = path.join(agentDirectory(job), "model.patch");
    return !fs.existsSync(patchPath) || fs.statSync(patchPath).size === 0;
  });
  assert.equal(
    missingPatches.length,
    0,
    `completed-only harness has missing patches: ${missingPatches.map((job) => job.key).join(", ")}`,
  );
  manifest.phase = "harness";
  manifest.harness_completed_only = true;
  manifest.harness_agent_outputs = harnessJobs.length;
  manifest.stop_reason = null;
  writeState(
    `starting official verifier for ${harnessJobs.length} completed outputs; one task image at a time`,
  );
  monitorTimer = setInterval(() => {
    recordMonitor(`scheduled ${Math.round(monitorMs / 1000)}-second monitor`);
    console.log(formatMonitorLine());
  }, monitorMs);
  monitorTimer.unref?.();
  await runHarnessBatches(harnessJobs, true);
  if (stopped || harnessJobs.some((job) => job.harness_state !== "completed")) {
    manifest.phase = "harness-stopped";
    writeState(
      manifest.stop_reason || "completed-only harness did not complete",
    );
    process.exitCode = 1;
    return;
  }
  manifest.phase = "completed-partial-agent-matrix";
  manifest.finished_at = new Date().toISOString();
  writeState(
    `${harnessJobs.length} completed agent outputs passed through harness`,
  );
  if (monitorTimer) clearInterval(monitorTimer);
}

async function runAgentBatches() {
  for (
    let batchIndex = 1;
    batchIndex <= manifest.task_batch_count;
    batchIndex += 1
  ) {
    const batchJobs = jobs.filter((job) => job.batch_index === batchIndex);
    assert.equal(
      batchJobs.length,
      manifest.runs_per_task_batch,
      `agent batch ${batchIndex} must contain exactly ${manifest.runs_per_task_batch} runs`,
    );
    const pending = batchJobs.filter((job) => job.state !== "completed");
    if (pending.length === 0) {
      writeState(
        `agent batch ${batchIndex}/${manifest.task_batch_count} already complete`,
      );
      continue;
    }
    manifest.current_batch = batchIndex;
    writeState(
      `agent batch ${batchIndex}/${manifest.task_batch_count}: ${taskBatchSize} tasks x ${variants.length} replicates; pending=${pending.length}; worker-capacity=${concurrency}`,
    );
    await runQueue(pending, concurrency, runAgentJob);
    const invalid = batchJobs.filter(
      (job) =>
        job.state !== "completed" ||
        job.scheme_ok !== true ||
        job.docker_routing_ok !== true,
    );
    if (stopped || invalid.length > 0) {
      manifest.stop_reason =
        manifest.stop_reason ||
        `agent batch ${batchIndex} contract gate failed: ${invalid.map((job) => job.key).join(", ")}`;
      return;
    }
    writeState(
      `agent batch ${batchIndex}/${manifest.task_batch_count} complete and contract-valid`,
    );
  }
  manifest.current_batch = null;
}

async function runHarnessBatches(harnessJobs = jobs, allowPartial = false) {
  const batches = buildHarnessBatches(selection.tasks, harnessJobs, {
    allowPartial,
  });
  for (const batch of batches) {
    const pending = batch.jobs.filter(
      (job) => job.harness_state !== "completed",
    );
    if (pending.length === 0) continue;
    const taskId = batch.tasks[0].task_id;
    const batchConcurrency =
      taskId === "numba-stencil-boundary-modes" ? 2 : HARNESS_CONCURRENCY;
    writeState(
      `harness image batch ${batch.index}/${batches.length}: ${taskId}; ${batch.jobs.length} variants share this task image; concurrency=${batchConcurrency}`,
    );
    await runQueue(pending, batchConcurrency, runHarnessJob);
    if (stopped || pending.some((job) => job.harness_state !== "completed"))
      return;
  }
}

async function runQueue(queue, workers, callback) {
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async (_, workerIndex) => {
      for (;;) {
        if (stopped) return;
        const index = next++;
        if (index >= queue.length) return;
        const job = queue[index];
        job.worker = workerIndex + 1;
        await callback(job);
      }
    }),
  );
}

async function runAgentJob(job) {
  let container = null;
  let seedContainer = null;
  const agentDir = agentDirectory(job);
  const workspace = workspacePath(job, `${Date.now()}-${crypto.randomUUID()}`);
  job.workspace_path = workspace;
  try {
    const promptRevision = readJson(
      path.join(runRoot, "prompt-revision.json"),
      null,
    );
    if (promptRevision?.revision) {
      job.run_generation = "post-tdd-debug-prompt";
      job.prompt_revision = promptRevision.revision;
      job.prompt_revision_marked_at = promptRevision.marked_at;
      job.tdd_debug_runtime_prompt_applies =
        genericAgentKind(job.agent) === "tura";
    }
    assertDiskCapacity();
    archivePreviousAttempt(job);
    job.state = "running";
    job.phase = "pulling-image";
    job.exit_code = null;
    job.error = null;
    job.round_count = 0;
    job.tool_call_count = 0;
    job.input_tokens = 0;
    job.cached_input_tokens = 0;
    job.output_tokens = 0;
    job.reasoning_tokens = 0;
    job.total_tokens = 0;
    job.patch_bytes = 0;
    job.scheme_ok = null;
    job.docker_routing_ok = null;
    job.started_at = job.started_at || new Date().toISOString();
    writeState(`starting ${job.key}`);
    await ensureImage(job.task.docker_image);
    assertDiskCapacity();

    fs.mkdirSync(agentDir, { recursive: true });
    await resetWorkspace(workspace);
    fs.mkdirSync(workspace, { recursive: true });
    seedContainer = containerName(job, "seed");
    await removeContainer(seedContainer);
    await runOk(
      "docker",
      [
        "run",
        "-d",
        "--name",
        seedContainer,
        "--network",
        "none",
        "-w",
        "/app",
        job.task.docker_image,
        "sleep",
        "infinity",
      ],
      { timeoutMs: 120_000 },
    );
    job.phase = "copying-workspace";
    writeManifest();
    await runOk("docker", ["cp", `${seedContainer}:/app/.`, workspace], {
      timeoutMs: 20 * 60_000,
    });
    await removeContainer(seedContainer);
    seedContainer = null;
    await runOk("git", ["-C", workspace, "config", "core.filemode", "false"]);
    await runOk("git", ["-C", workspace, "config", "core.autocrlf", "false"]);
    await runOk("git", ["-C", workspace, "config", "core.safecrlf", "false"]);

    container = containerName(job, "agent");
    await removeContainer(container);
    await runOk(
      "docker",
      [
        "run",
        "-d",
        "--name",
        container,
        "--network",
        "none",
        "--cpus",
        String(job.task.cpus),
        "--memory",
        `${job.task.memory_mb}m`,
        "--mount",
        `type=bind,source=${workspace},target=/app`,
        "-w",
        "/app",
        job.task.docker_image,
        "sleep",
        "infinity",
      ],
      { timeoutMs: 120_000 },
    );
    const preflight = await runOk(
      "docker",
      [
        "exec",
        container,
        "bash",
        "-lc",
        [
          "git config core.filemode false",
          "git config core.autocrlf false",
          'test "$(git rev-parse HEAD)" = "$(git rev-parse \'' +
            job.task.base_commit_hash +
            "^{commit}')\"",
          'test "$(pwd)" = /app',
          "git status --porcelain",
        ].join(" && "),
      ],
      { timeoutMs: 10 * 60_000 },
    );
    // Some official images intentionally modify tracked files while installing
    // compatible runtime dependencies. Preserve that exact image state as the
    // patch baseline instead of requiring an artificially clean worktree.
    const baselineTree = (
      await runOk(
        "docker",
        [
          "exec",
          container,
          "bash",
          "-lc",
          [
            "git add -A",
            "tree=$(git write-tree)",
            "git reset --mixed -q HEAD",
            "printf '%s' \"$tree\"",
          ].join(" && "),
        ],
        { timeoutMs: 10 * 60_000 },
      )
    ).stdout.trim();
    if (!/^[0-9a-f]{40,64}$/i.test(baselineTree)) {
      throw new Error(
        `invalid image baseline tree for ${job.key}: ${baselineTree}`,
      );
    }
    writeJson(path.join(agentDir, "docker-preflight.json"), {
      schema: "tura.benchmark.deep-swe-docker-preflight.v1",
      container,
      image: job.task.docker_image,
      image_id: (
        await runOk("docker", [
          "image",
          "inspect",
          job.task.docker_image,
          "--format",
          "{{.Id}}",
        ])
      ).stdout.trim(),
      workdir: "/app",
      base_commit_hash: job.task.base_commit_hash,
      baseline_tree: baselineTree,
      initial_git_status: preflight.stdout,
      network: "none",
      cpus: job.task.cpus,
      memory_mb: job.task.memory_mb,
      output: preflight.stdout,
    });

    job.phase = "agent-running";
    writeManifest();
    const prompt = buildPrompt(job, container);
    fs.writeFileSync(path.join(agentDir, "prompt.md"), prompt, "utf8");
    const result = await runGenericAgentCli({
      agentId: job.agent,
      workspace,
      agentDir,
      prompt,
      repoRoot,
      model: "gpt-5.6-sol",
      turaModel: "openai/gpt-5.6-sol",
      reasoning: job.reasoning,
      serviceTier: "default",
      timeoutMs: Math.max(60_000, Number(job.task.agent_timeout_sec) * 1000),
      idleTimeoutMs: 0,
      turaBashDockerContainer: container,
      turaBashDockerWorkdir: "/app",
      turaDbRoot: path.join(agentDir, "session-db-root"),
      sessionLogDbRoot: path.join(agentDir, "session-db-root"),
      onRound: (round, rounds) => {
        job.round_count = rounds.length;
        job.tool_call_count = rounds.reduce(
          (total, item) => total + (item.toolCalls?.length || 0),
          0,
        );
        job.total_tokens = rounds.reduce(
          (total, item) => total + Number(item.usage?.totalTokens || 0),
          0,
        );
        job.last_round_at = new Date().toISOString();
        writeManifest();
      },
    });

    const gitStatus = await runOk(
      "docker",
      ["exec", container, "git", "status", "--short"],
      { timeoutMs: 180_000 },
    );
    fs.writeFileSync(
      path.join(agentDir, "git-status.txt"),
      gitStatus.stdout,
      "utf8",
    );
    const patchResult = await runOk(
      "docker",
      [
        "exec",
        container,
        "bash",
        "-lc",
        ["git add -A", `git diff --cached --binary ${baselineTree}`].join(
          " && ",
        ),
      ],
      { timeoutMs: 5 * 60_000, maxBuffer: 256 * 1024 * 1024 },
    );
    const patchPath = path.join(agentDir, "model.patch");
    fs.writeFileSync(patchPath, patchResult.stdout, "utf8");
    const workspaceSnapshot = captureChangedWorkspace({
      sourceWorkspace: workspace,
      outputDirectory: path.join(agentDir, "workspace"),
      patchText: patchResult.stdout,
      provenance: {
        agent: job.agent,
        taskId: job.task.task_id,
        sourceRun: `runs/${job.task.task_id}/${job.agent}-r${job.replicate}`,
        repository: job.task.repository_url,
        baseCommit: job.task.base_commit_hash,
        baselineTree,
        recoverySource: "captured-before-raw-workspace-cleanup",
        diffVerifiedByteForByte: true,
      },
    });

    const scheme = await validateScheme(job, result, container);
    writeJson(path.join(agentDir, "scheme-validation.json"), scheme);
    const summary = {
      schema: "tura.benchmark.deep-swe-agent-summary.v1",
      agent: job.agent,
      agent_id: job.agent,
      agent_kind: genericAgentKind(job.agent),
      agent_mode: genericAgentMode(job.agent),
      replicate: job.replicate,
      model: job.agent === "codex-cli" ? "gpt-5.6-sol" : "openai/gpt-5.6-sol",
      tura_model:
        genericAgentKind(job.agent) === "tura" ? "openai/gpt-5.6-sol" : null,
      reasoning: job.reasoning,
      service_tier: "default",
      priority_enabled: false,
      task: job.task.task_id,
      task_id: job.task.task_id,
      instance_id: job.task.task_id,
      repo: job.task.repository_url,
      workspace,
      docker: {
        container,
        image: job.task.docker_image,
        workdir: "/app",
        network: "none",
      },
      elapsed_ms: result.duration_ms,
      exit_code: result.status,
      signal: result.signal,
      timed_out: Boolean(result.timed_out),
      first_output_ms: result.first_output_ms,
      last_progress_ms: result.last_progress_ms,
      error: result.error || null,
      stdout_path: path.join(agentDir, "stdout.jsonl"),
      stderr_path: path.join(agentDir, "stderr.log"),
      provider_log_path: path.join(agentDir, "provider-log"),
      usage: result.usage_info?.usage || emptyUsage(),
      usage_source: result.usage_info?.usage_source || null,
      provider_calls: result.usage_info?.provider_calls ?? null,
      rounds: result.rounds,
      rounds_directory: result.rounds_directory,
      rounds_jsonl_path: result.rounds_jsonl_path,
      round_contract_validation: result.round_contract_validation,
      scheme_validation: scheme,
      events: result.events || {},
      patch: {
        patch_path: patchPath,
        patch_bytes: Buffer.byteLength(patchResult.stdout),
        changed_files: changedFiles(patchResult.stdout),
        baseline_tree: baselineTree,
      },
      workspace_snapshot: workspaceSnapshot,
    };
    writeJson(agentSummaryPath(job), summary);
    job.exit_code = result.status;
    job.round_count = result.rounds.length;
    job.tool_call_count = Math.max(
      result.round_contract_validation.tool_call_count,
      countCompletedCodexCommands(path.join(agentDir, "stdout.jsonl")),
    );
    assignUsage(job, result.usage_info?.usage);
    job.patch_bytes = summary.patch.patch_bytes;
    job.scheme_ok = scheme.round_contract_ok;
    job.docker_routing_ok = scheme.docker_routing_ok;
    // Official SWE-style execution captures and grades the workspace at the
    // time limit. A timeout is therefore a completed agent attempt when its
    // emitted rounds and Docker routing still satisfy the data contract.
    job.state =
      (result.status === 0 || result.timed_out) && scheme.ok
        ? "completed"
        : "failed";
    job.phase = job.state;
    job.error = result.error || (scheme.ok ? null : scheme.errors.join("; "));
    job.finished_at = new Date().toISOString();
  } catch (error) {
    job.state = "failed";
    job.phase = "failed";
    job.error = String(error?.stack || error);
    job.finished_at = new Date().toISOString();
    writeText(path.join(agentDir, "runner-error.log"), job.error);
    if (/no space left|not enough space|disk full/i.test(job.error))
      stopForDisk(job.error);
  } finally {
    if (seedContainer) await removeContainer(seedContainer);
    if (container) await removeContainer(container);
    if (!keepWorkspaces && fs.existsSync(workspace)) {
      const cleanup = await removeWorkspaceWithRetry(workspace);
      writeJson(path.join(agentDir, "workspace-lifecycle.json"), {
        removed_after_patch_capture: cleanup.removed,
        retained_after_cleanup_retries: !cleanup.removed,
        cleanup_error: cleanup.error,
        removal_is_normal_lifecycle_not_disk_recovery: true,
        attempted_at: new Date().toISOString(),
      });
    }
    writeState(`${job.key} ${job.state}`);
  }
  return job;
}

async function runHarnessJob(job) {
  const agentDir = agentDirectory(job);
  const harnessDir = path.join(agentDir, "harness");
  try {
    assertDiskCapacity();
    job.harness_state = "running";
    writeManifest();
    const verifierImage = await ensureVerifierImage(job.task);
    const logsDir = path.join(harnessDir, "logs");
    const artifactsDir = path.join(logsDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.copyFileSync(
      path.join(agentDir, "model.patch"),
      path.join(artifactsDir, "model.patch"),
    );
    const container = containerName(job, "verify");
    await removeContainer(container);
    const result = await runProcess(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        container,
        "--network",
        "none",
        "--cpus",
        String(job.task.cpus),
        "--memory",
        `${job.task.memory_mb}m`,
        "--mount",
        `type=bind,source=${logsDir},target=/logs`,
        verifierImage,
        "/bin/bash",
        "-lc",
        VERIFIER_COMMAND,
      ],
      {
        timeoutMs: Math.max(
          60_000,
          Number(job.task.verifier_timeout_sec) * 1000,
        ),
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    writeText(path.join(harnessDir, "stdout.log"), result.stdout);
    writeText(path.join(harnessDir, "stderr.log"), result.stderr);
    const rewardPath = path.join(logsDir, "verifier", "reward.json");
    const rewardTextPath = path.join(logsDir, "verifier", "reward.txt");
    const reward = fs.existsSync(rewardPath)
      ? readJson(rewardPath)
      : {
          reward: Number(
            fs.existsSync(rewardTextPath)
              ? fs.readFileSync(rewardTextPath, "utf8").trim()
              : -1,
          ),
        };
    const report = {
      schema: "tura.benchmark.deep-swe-harness-report.v1",
      task_id: job.task.task_id,
      agent: job.agent,
      replicate: job.replicate,
      verifier_image: verifierImage,
      official_environment_image: job.task.docker_image,
      exit_code: result.status,
      timed_out: result.timedOut,
      reward,
      passed: Number(reward.reward) === 1,
      verifier_script_line_endings_normalized: true,
      completed_at: new Date().toISOString(),
    };
    writeJson(path.join(harnessDir, "report.json"), report);
    if (!validHarnessReport(report)) {
      throw new Error(
        `invalid verifier result: exit=${result.status} reward=${reward.reward}`,
      );
    }
    job.harness_score = Number(reward.reward);
    job.harness_state = "completed";
    job.harness_error = null;
  } catch (error) {
    job.harness_state = "failed";
    job.harness_error = String(error?.stack || error);
    writeText(path.join(harnessDir, "runner-error.log"), job.harness_error);
    if (/no space left|not enough space|disk full/i.test(job.harness_error))
      stopForDisk(job.harness_error);
  } finally {
    writeState(`${job.key} harness ${job.harness_state}`);
  }
}

async function validateScheme(job, result, container) {
  const errors = [];
  const invocationPath = path.join(
    agentDirectory(job),
    "context-and-calls",
    "invocation.json",
  );
  const invocation = readJson(invocationPath, {});
  if (!result.round_contract_validation?.ok)
    errors.push(
      ...(result.round_contract_validation?.errors || [
        "generic round validation failed",
      ]),
    );
  const schemaResult = await runProcess(
    projectPython(repoRoot),
    [path.join(scriptDir, "validate_rounds.py"), result.rounds_jsonl_path],
    { timeoutMs: 120_000 },
  );
  const schemaOutput = parseJson(schemaResult.stdout, {
    ok: false,
    errors: [schemaResult.stderr],
  });
  if (schemaResult.status !== 0 || !schemaOutput.ok)
    errors.push(...(schemaOutput.errors || ["JSON schema validation failed"]));
  if (invocation.service_tier !== "default")
    errors.push(`service tier is ${invocation.service_tier}`);
  if (priorityEnabled(invocation.service_tier))
    errors.push("priority mode is enabled");
  const args = Array.isArray(invocation.args) ? invocation.args : [];
  if (args.includes("--sandbox")) errors.push("Tura sandbox flag is present");
  if (args.includes("--embedded")) errors.push("Tura embedded flag is present");

  let dockerRoutingOk = true;
  if (genericAgentKind(job.agent) === "tura") {
    if (args.slice(0, 3).join(" ") !== "exec bash --json")
      errors.push(
        `Tura args do not start with exec bash --json: ${args.slice(0, 3).join(" ")}`,
      );
    if (invocation.env?.TURA_BASH_DOCKER_CONTAINER !== container)
      errors.push(
        "Tura invocation did not archive the assigned Docker container",
      );
    if (invocation.env?.TURA_BASH_DOCKER_WORKDIR !== "/app")
      errors.push("Tura Docker workdir is not /app");
    dockerRoutingOk =
      invocation.env?.TURA_BASH_DOCKER_CONTAINER === container &&
      invocation.env?.TURA_BASH_DOCKER_WORKDIR === "/app";
  } else {
    const commands = parseJsonl(path.join(agentDirectory(job), "stdout.jsonl"))
      .filter((event) => event?.item?.type === "command_execution")
      .map((event) =>
        String(event.item.command || event.item.command_line || ""),
      );
    if (commands.length === 0)
      errors.push("codex-cli produced no command execution events");
    const escaped = commands.filter(
      (command) =>
        !/\bdocker(?:\s+--%)?\s+exec\b/i.test(command) ||
        !command.includes(container),
    );
    if (escaped.length > 0)
      errors.push(
        `${escaped.length} codex-cli commands did not target the assigned Docker container`,
      );
    dockerRoutingOk = commands.length > 0 && escaped.length === 0;
  }

  const roundContractOk = Boolean(
    result.round_contract_validation?.ok && schemaOutput.ok,
  );
  return {
    schema: "tura.benchmark.deep-swe-scheme-validation.v1",
    ok: errors.length === 0,
    round_contract_ok: roundContractOk,
    json_schema_ok: Boolean(schemaOutput.ok),
    docker_routing_ok: dockerRoutingOk,
    round_count: result.rounds?.length || 0,
    tool_call_count: result.round_contract_validation?.tool_call_count || 0,
    errors,
  };
}

function repairCodexDockerRoutingFalseNegative(job) {
  if (job.agent !== "codex-cli" || job.state !== "failed") return false;
  const summaryPath = agentSummaryPath(job);
  const schemePath = path.join(agentDirectory(job), "scheme-validation.json");
  const preflightPath = path.join(agentDirectory(job), "docker-preflight.json");
  if (
    ![summaryPath, schemePath, preflightPath].every((item) =>
      fs.existsSync(item),
    )
  )
    return false;
  const summary = readJson(summaryPath, null);
  const scheme = readJson(schemePath, null);
  const preflight = readJson(preflightPath, null);
  if (
    !summary ||
    !scheme ||
    !preflight?.container ||
    Number(summary.exit_code) !== 0
  )
    return false;
  if (!summary.round_contract_validation?.ok || !scheme.json_schema_ok)
    return false;
  const oldErrors = Array.isArray(scheme.errors) ? scheme.errors : [];
  if (
    oldErrors.length === 0 ||
    oldErrors.some(
      (error) =>
        !/codex-cli commands did not target the assigned Docker container/.test(
          error,
        ),
    )
  )
    return false;
  const commands = parseJsonl(path.join(agentDirectory(job), "stdout.jsonl"))
    .filter((event) => event?.item?.type === "command_execution")
    .map((event) =>
      String(event.item.command || event.item.command_line || ""),
    );
  const allRouted =
    commands.length > 0 &&
    commands.every(
      (command) =>
        /\bdocker(?:\s+--%)?\s+exec\b/i.test(command) &&
        command.includes(preflight.container),
    );
  if (!allRouted) return false;
  const repairedScheme = {
    ...scheme,
    ok: true,
    docker_routing_ok: true,
    errors: [],
  };
  writeJson(schemePath, repairedScheme);
  writeJson(summaryPath, { ...summary, scheme_validation: repairedScheme });
  job.state = "completed";
  job.phase = "completed";
  job.error = null;
  job.scheme_ok = true;
  job.docker_routing_ok = true;
  job.repaired_validation =
    "accepted PowerShell docker --% exec after exact-container re-audit";
  return true;
}

function repairContractValidTimeout(job) {
  if (job.state !== "failed") return false;
  const summaryPath = agentSummaryPath(job);
  const schemePath = path.join(agentDirectory(job), "scheme-validation.json");
  if (![summaryPath, schemePath].every((item) => fs.existsSync(item)))
    return false;
  const summary = readJson(summaryPath, null);
  const scheme = readJson(schemePath, null);
  const patchPath = summary?.patch?.patch_path;
  if (
    !summary?.timed_out ||
    !scheme?.ok ||
    !summary.round_contract_validation?.ok
  )
    return false;
  if (!patchPath || !fs.existsSync(patchPath)) return false;
  job.state = "completed";
  job.phase = "completed";
  job.scheme_ok = true;
  job.docker_routing_ok = true;
  job.timed_out = true;
  job.repaired_validation =
    "contract-valid timeout retained for official harness grading";
  return true;
}

function buildPrompt(job, container) {
  const instruction = fs
    .readFileSync(
      path.join(tasksRoot, job.task.task_id, "instruction.md"),
      "utf8",
    )
    .trim();
  const shared = [
    instruction,
    "",
    "## Benchmark environment rules",
    "",
    `The official DeepSWE v1.1 development environment is Docker container \`${container}\` at \`/app\`.`,
    "The container has no network, matching the official task configuration.",
    "Do not inspect or access the benchmark tests, verifier, reference solution, or DeepSWE task source directory.",
    "Make the requested implementation in the current repository workspace. Do not merely describe a patch.",
    "Run relevant repository tests inside the official container when practical.",
    "Do not enable or request sandbox, embedded, or priority modes.",
  ];
  if (job.agent === "codex-cli") {
    shared.push(
      "Every shell command, including reads, searches, git commands, and tests, MUST be executed through " +
        `\`docker exec -w /app ${container} bash -lc '<command>'\`.`,
      "Never run repository shell commands directly in Windows PowerShell. File-edit tools may edit the current host workspace because it is bind-mounted to /app.",
    );
  } else {
    shared.push(
      "Your bash tool is already routed to this container and /app; use ordinary Linux bash commands without adding docker exec yourself.",
      "File-edit tools operate on the host side of the same bind mount and are visible immediately inside /app.",
    );
  }
  return shared.join("\n") + "\n";
}

async function ensureImage(image) {
  if (!imagePromises.has(image)) {
    imagePromises.set(
      image,
      (async () => {
        const inspected = await runProcess(
          "docker",
          ["image", "inspect", image, "--format", "{{.Id}}"],
          { timeoutMs: 30_000 },
        );
        if (inspected.status !== 0)
          await runOk("docker", ["pull", image], {
            timeoutMs: 30 * 60_000,
            maxBuffer: 128 * 1024 * 1024,
          });
        const result = await runOk(
          "docker",
          ["image", "inspect", image, "--format", "{{.Id}} {{.Size}}"],
          { timeoutMs: 30_000 },
        );
        return result.stdout.trim();
      })(),
    );
  }
  return imagePromises.get(image);
}

async function ensureVerifierImage(task) {
  if (!verifierImagePromises.has(task.task_id)) {
    verifierImagePromises.set(
      task.task_id,
      (async () => {
        await ensureImage(task.docker_image);
        const tag = `tura-deepswe-verifier:${hashText(task.task_id).slice(0, 12)}`;
        const inspected = await runProcess(
          "docker",
          ["image", "inspect", tag],
          { timeoutMs: 30_000 },
        );
        if (inspected.status !== 0) {
          await runOk(
            "docker",
            ["build", "-t", tag, path.join(tasksRoot, task.task_id, "tests")],
            {
              timeoutMs: 30 * 60_000,
              maxBuffer: 256 * 1024 * 1024,
            },
          );
        }
        return tag;
      })(),
    );
  }
  return verifierImagePromises.get(task.task_id);
}

function assertDiskCapacity() {
  const freeGb = diskFreeGb();
  if (freeGb <= diskSafetyFloorGb) {
    stopForDisk(
      `C: free space ${freeGb.toFixed(2)} GB is at or below the ${diskSafetyFloorGb} GB safety floor`,
    );
    throw new Error(manifest.stop_reason);
  }
  return freeGb;
}

function stopForDisk(reason) {
  stopped = true;
  manifest.stop_reason = `disk stop without cleanup: ${reason}`;
  manifest.phase = "stopped-disk";
  writeState(manifest.stop_reason);
}

function diskFreeGb() {
  const stats = fs.statfsSync(path.parse(runRoot).root);
  return (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3;
}

function recordMonitor(note) {
  const usage = aggregateJobUsage();
  const cost = costEstimateForUsage(usage, {
    model: "gpt-5.6-sol",
    serviceTier: "default",
  });
  const entry = {
    at: new Date().toISOString(),
    phase: manifest.phase,
    active: jobs.filter(
      (job) => job.state === "running" || job.harness_state === "running",
    ).length,
    agent_completed: jobs.filter((job) => job.state === "completed").length,
    agent_failed: jobs.filter((job) => job.state === "failed").length,
    harness_completed: jobs.filter((job) => job.harness_state === "completed")
      .length,
    harness_failed: jobs.filter((job) => job.harness_state === "failed").length,
    llm_turns: jobs.reduce(
      (total, job) => total + Number(job.round_count || 0),
      0,
    ),
    tool_calls: jobs.reduce(
      (total, job) => total + Number(job.tool_call_count || 0),
      0,
    ),
    input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    total_tokens: usage.total_tokens,
    estimated_cost_usd: cost.costUsd,
    free_gb: diskFreeGb(),
    note,
  };
  manifest.monitor_log.push(entry);
  writeManifest();
  writeProgress();
}

function writeState(note) {
  recordMonitor(note);
  console.log(
    `[deep-swe ${new Date().toISOString()}] ${note}; ${formatMonitorLine()}`,
  );
}

function formatMonitorLine() {
  const latest = manifest.monitor_log.at(-1) || {};
  return `phase=${manifest.phase} batch=${manifest.current_batch || "-"}/${manifest.task_batch_count} active=${jobs.filter((job) => job.state === "running" || job.harness_state === "running").length}/${concurrency} agent=${jobs.filter((job) => job.state === "completed").length}/${jobs.length} harness=${jobs.filter((job) => job.harness_state === "completed").length}/${jobs.length} turns=${latest.llm_turns || 0} input=${latest.input_tokens || 0} output=${latest.output_tokens || 0} tokens=${latest.total_tokens || 0} cost=$${Number(latest.estimated_cost_usd || 0).toFixed(6)} free=${diskFreeGb().toFixed(2)}GB`;
}

function writeManifest() {
  writeJsonAtomic(manifestPath, manifest);
}

function writeProgress() {
  const latest = manifest.monitor_log.at(-1);
  const lines = [
    `# DeepSWE ${selection.tasks.length} x ${variants.length} progress`,
    "",
    `- Run ID: \`${runId}\``,
    "- Benchmark: DeepSWE v1.1",
    `- Planned runs: ${jobs.length} (\`${selection.tasks.length} tasks x ${variants.length} configured variants\`)`,
    `- Concurrency: ${concurrency} worker slots`,
    `- Agent batches: ${manifest.task_batch_count} sequential batches of ${taskBatchSize} tasks x ${variants.length} replicates`,
    `- Variants: ${variants.map((variant) => `${variant.agent}#${variant.replicate}:${variant.reasoning}`).join(", ")}`,
    `- Harness: deferred until all ${jobs.length} agent runs finish; official images are retained and reused`,
    "- Disk: monitored only; stop without cleanup at the configured safety floor",
    "",
    "## Current status",
    "",
    `- Phase: ${manifest.phase}`,
    `- Active worker slots: ${latest?.active ?? 0} / ${concurrency}`,
    `- Completed agent runs: ${jobs.filter((job) => job.state === "completed").length} / ${jobs.length}`,
    `- Failed agent runs: ${jobs.filter((job) => job.state === "failed").length}`,
    `- Completed harness runs: ${jobs.filter((job) => job.harness_state === "completed").length} / ${jobs.length}`,
    `- Failed harness runs: ${jobs.filter((job) => job.harness_state === "failed").length}`,
    `- Contract-valid agent runs: ${jobs.filter((job) => job.scheme_ok === true && job.docker_routing_ok === true).length} / ${jobs.length}`,
    `- LLM turns: ${latest?.llm_turns ?? 0}`,
    `- Input / cached input / output / reasoning tokens: ${latest?.input_tokens ?? 0} / ${latest?.cached_input_tokens ?? 0} / ${latest?.output_tokens ?? 0} / ${latest?.reasoning_tokens ?? 0}`,
    `- Total tokens: ${latest?.total_tokens ?? 0}`,
    `- Estimated token cost: $${Number(latest?.estimated_cost_usd || 0).toFixed(6)}`,
    `- C: free space: ${(latest?.free_gb ?? diskFreeGb()).toFixed(2)} GB`,
    `- Stop reason: ${manifest.stop_reason || "none"}`,
    "",
    "## Frozen selection",
    "",
    "Difficulty is the per-language rank quartile computed from 18,396 official scored DeepSWE v1.1 trials.",
    "",
    "| Language | Difficulty | Official pass rate | Task |",
    "|---|---|---:|---|",
    ...selection.tasks.map(
      (task) =>
        `| ${task.language} | ${task.difficulty_band} | ${(task.official_pass_rate * 100).toFixed(3)}% | \`${task.task_id}\` |`,
    ),
    "",
    "## Job totals by agent",
    "",
    "| Agent | Completed | Failed | Harness completed | Harness passed | Tokens |",
    "|---|---:|---:|---:|---:|---:|",
    ...[...new Set(variants.map((variant) => variant.agent))].map((agent) => {
      const subset = jobs.filter((job) => job.agent === agent);
      return `| ${agent} | ${subset.filter((job) => job.state === "completed").length}/${subset.length} | ${subset.filter((job) => job.state === "failed").length} | ${subset.filter((job) => job.harness_state === "completed").length}/${subset.length} | ${subset.filter((job) => job.harness_score === 1).length} | ${subset.reduce((total, job) => total + Number(job.total_tokens || 0), 0)} |`;
    }),
    "",
    "## Monitor log",
    "",
    "| Time (UTC) | Phase | Active | Agent runs | Harness | C: free | Note |",
    "|---|---|---:|---:|---:|---:|---|",
    ...manifest.monitor_log.map(
      (entry) =>
        `| ${entry.at} | ${entry.phase} | ${entry.active}/${concurrency} | ${entry.agent_completed}/${jobs.length} | ${entry.harness_completed}/${jobs.length} | ${entry.free_gb.toFixed(2)} GB | ${String(entry.note).replaceAll("|", "\\|")} |`,
    ),
    "",
  ];
  fs.writeFileSync(progressPath, lines.join("\n"), "utf8");
}

function agentDirectory(job) {
  return path.join(
    runRoot,
    "runs",
    job.task.task_id,
    `${job.agent}-r${job.replicate}`,
  );
}

function agentSummaryPath(job) {
  return path.join(agentDirectory(job), "agent-summary.json");
}

function recoverManifestFromArtifacts() {
  const recoveredJobs = [];
  for (const job of jobs) {
    const summaryPath = agentSummaryPath(job);
    if (!fs.existsSync(summaryPath)) continue;
    const summary = readJson(summaryPath, null);
    if (summary?.schema !== "tura.benchmark.deep-swe-agent-summary.v1")
      continue;
    if (
      summary.task_id !== job.task.task_id ||
      summary.agent !== job.agent ||
      Number(summary.replicate) !== job.replicate
    )
      continue;
    const scheme =
      summary.scheme_validation ||
      readJson(path.join(agentDirectory(job), "scheme-validation.json"), null);
    const roundContract = summary.round_contract_validation;
    const patchPath =
      summary.patch?.patch_path ||
      path.join(agentDirectory(job), "model.patch");
    const completed =
      (Number(summary.exit_code) === 0 || summary.timed_out === true) &&
      scheme?.ok === true &&
      roundContract?.ok === true &&
      fs.existsSync(patchPath);
    const harnessReport = readJson(
      path.join(agentDirectory(job), "harness", "report.json"),
      null,
    );
    recoveredJobs.push({
      ...job,
      state: completed ? "completed" : "failed",
      phase: completed ? "completed" : "failed",
      exit_code: summary.exit_code,
      error:
        summary.error ||
        (scheme?.ok ? null : (scheme?.errors || []).join("; ")),
      round_count: Number(scheme?.round_count || summary.rounds?.length || 0),
      tool_call_count: Number(
        roundContract?.tool_call_count || scheme?.tool_call_count || 0,
      ),
      total_tokens: Number(summary.usage?.total_tokens || 0),
      input_tokens: Number(summary.usage?.input_tokens || 0),
      cached_input_tokens: Number(summary.usage?.cached_input_tokens || 0),
      output_tokens: Number(summary.usage?.output_tokens || 0),
      reasoning_tokens: Number(summary.usage?.reasoning_tokens || 0),
      patch_bytes: Number(summary.patch?.patch_bytes || 0),
      scheme_ok: scheme?.round_contract_ok === true,
      docker_routing_ok: scheme?.docker_routing_ok === true,
      timed_out: summary.timed_out === true,
      harness_state: harnessReport ? "completed" : "pending",
      harness_score: harnessReport
        ? Number(harnessReport.reward?.reward ?? harnessReport.reward ?? 0)
        : null,
      harness_error: harnessReport?.error || null,
      recovered_from_artifacts: true,
    });
  }
  if (recoveredJobs.length === 0) return null;
  return {
    phase: "agent-runs",
    started_at: null,
    finished_at: null,
    monitor_log: [],
    stop_reason: null,
    jobs: recoveredJobs,
  };
}

function archivePreviousAttempt(job) {
  const agentDir = agentDirectory(job);
  if (!fs.existsSync(agentDir)) return;
  const attemptsRoot = path.join(runRoot, "_attempts");
  assertInside(path.join(runRoot, "runs"), agentDir);
  fs.mkdirSync(attemptsRoot, { recursive: true });
  const archive = path.join(
    attemptsRoot,
    `${job.key}__${new Date().toISOString().replace(/[-:.TZ]/g, "")}`,
  );
  assertInside(attemptsRoot, archive);
  fs.renameSync(agentDir, archive);
}

function workspacePath(job, attempt = "legacy") {
  return path.join(
    workspacesRoot,
    hashText(`${job.key}:${attempt}`).slice(0, 16),
  );
}

async function resetWorkspace(workspace) {
  assertInside(workspacesRoot, workspace);
  if (!fs.existsSync(workspace)) return;
  const cleanup = await removeWorkspaceWithRetry(workspace);
  if (!cleanup.removed)
    throw new Error(
      `could not reset retained workspace ${workspace}: ${cleanup.error}`,
    );
}

async function removeWorkspaceWithRetry(workspace) {
  assertInside(workspacesRoot, workspace);
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      if (fs.existsSync(workspace))
        fs.rmSync(workspace, { recursive: true, force: true });
      return { removed: !fs.existsSync(workspace), error: null };
    } catch (error) {
      lastError = String(error?.message || error);
      await delay(attempt * 1000);
    }
  }
  return { removed: !fs.existsSync(workspace), error: lastError };
}

function containerName(job, suffix) {
  return `tura-ds-${hashText(`${runId}:${job.key}:${suffix}`).slice(0, 18)}-${suffix}`;
}

async function removeContainer(name) {
  await runProcess("docker", ["rm", "-f", name], { timeoutMs: 60_000 });
}

function changedFiles(patchText) {
  return [
    ...new Set(
      String(patchText)
        .split(/\r?\n/)
        .filter((line) => line.startsWith("diff --git a/"))
        .map((line) => line.match(/^diff --git a\/(.+?) b\/(.+)$/)?.[2])
        .filter(Boolean),
    ),
  ];
}

function parseJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseJson(line, null))
    .filter(Boolean);
}

function countCompletedCodexCommands(file) {
  return parseJsonl(file).filter(
    (event) =>
      event?.type === "item.completed" &&
      event?.item?.type === "command_execution",
  ).length;
}

function emptyUsage() {
  return {
    usage_events: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 0,
    latency_ms: 0,
  };
}

function assignUsage(job, usage = {}) {
  job.input_tokens = Number(usage?.input_tokens || 0);
  job.cached_input_tokens = Number(usage?.cached_input_tokens || 0);
  job.output_tokens = Number(usage?.output_tokens || 0);
  job.reasoning_tokens = Number(usage?.reasoning_tokens || 0);
  job.total_tokens = Number(
    usage?.total_tokens || job.input_tokens + job.output_tokens,
  );
}

function aggregateJobUsage() {
  return jobs.reduce(
    (total, job) => {
      total.input_tokens += Number(job.input_tokens || 0);
      total.cached_input_tokens += Number(job.cached_input_tokens || 0);
      total.output_tokens += Number(job.output_tokens || 0);
      total.reasoning_tokens += Number(job.reasoning_tokens || 0);
      total.total_tokens += Number(job.total_tokens || 0);
      return total;
    },
    {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
    },
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function findCommand(name) {
  const result = spawnSync(
    process.platform === "win32" ? "where.exe" : "sh",
    process.platform === "win32" ? [name] : ["-lc", `command -v ${name}`],
    { encoding: "utf8", windowsHide: true },
  );
  return result.status === 0
    ? String(result.stdout || "")
        .split(/\r?\n/)
        .find(Boolean)
    : null;
}

function positiveInteger(value, label) {
  const number = Number(value);
  assert(
    Number.isInteger(number) && number > 0,
    `${label} must be a positive integer`,
  );
  return number;
}

function parseVariants(value, configured) {
  const variants = value ? JSON.parse(value) : configured;
  assert(
    Array.isArray(variants) && variants.length > 0,
    "configure at least one DeepSWE variant",
  );
  for (const variant of variants) {
    assert(
      typeof variant.agent === "string" && variant.agent,
      "each DeepSWE variant requires an agent",
    );
    positiveInteger(variant.replicate, "DeepSWE variant replicate");
    assert(
      typeof variant.reasoning === "string" && variant.reasoning,
      "each DeepSWE variant requires reasoning",
    );
  }
  return variants;
}

function uniqueReasoning(kind) {
  const values = [
    ...new Set(
      variants
        .filter((variant) => genericAgentKind(variant.agent) === kind)
        .map((variant) => variant.reasoning),
    ),
  ];
  return values.length === 0 ? null : values.length === 1 ? values[0] : values;
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `unsafe path outside ${root}: ${target}`,
  );
}

function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(String(text));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(value || ""), "utf8");
}

async function runOk(command, args, options = {}) {
  const result = await runProcess(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxBuffer = options.maxBuffer || 64 * 1024 * 1024;
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBuffer) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBuffer) stderr.push(chunk);
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        status: null,
        signal: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: String(error),
        timedOut,
      });
    });
    child.on("close", (status, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: null,
        timedOut,
      });
    });
  });
}
