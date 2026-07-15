#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildAgentRoundContracts,
  costEstimateForProviderCalls,
  costEstimateForUsage,
} from "../lib/business_paths.mjs";
import { projectPython } from "../lib/python_runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "gpt-5.6-sol";
const EFFORT = "high";
const PUBLIC_AGENT_ID = "codex-cli-gpt5.6-sol-high";
const PUBLIC_AGENT_PATH = "codex-cli-high";
const EXPECTED_TASKS = 20;
const EXPECTED_REPLICATES = 3;
const EXPECTED_RUNS = 60;
const TASK_BATCH_SIZE = 5;
const WORKER_CONCURRENCY = 15;
const CODEX_CLI_VERSION = "0.144.1";
const CANONICAL_TASK_IDS = readJson(
  path.join(root, "deep_swe", "canonical_tasks.json"),
).tasks.map((task) => task.task_id);

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const receipt = publishDeepSweCodexHigh({
    source: args.source,
    resultsRoot: args.resultsRoot,
    checkSourceOnly: args.checkSourceOnly,
  });
  console.log(JSON.stringify(receipt, null, 2));
}

export function auditDeepSweCodexHighManifest(manifest) {
  assert.equal(manifest?.schema, "tura.benchmark.deep-swe-matrix.v1");
  assert.equal(manifest?.benchmark, "datacurve-ai/deep-swe");
  assert.equal(manifest?.benchmark_version, "v1.1");
  assert.equal(manifest?.model, MODEL);
  assert.equal(manifest?.codex_cli_version, CODEX_CLI_VERSION);
  assert.equal(manifest?.concurrency, WORKER_CONCURRENCY);
  assert.equal(manifest?.task_batch_size, TASK_BATCH_SIZE);
  assert.equal(manifest?.task_batch_count, 4);
  assert.equal(manifest?.runs_per_task_batch, WORKER_CONCURRENCY);
  assert.equal(manifest?.task_batches_are_sequential, true);
  assert.equal(manifest?.planned_agent_runs, EXPECTED_RUNS);
  assert.equal(manifest?.planned_harness_runs, EXPECTED_RUNS);
  assert.equal(manifest?.phase, "completed");
  assert(Array.isArray(manifest.jobs), "DeepSWE manifest.jobs is required");
  assert.equal(manifest.jobs.length, EXPECTED_RUNS);

  const keys = new Set();
  const tasks = new Set();
  const replicates = new Set();
  for (const job of manifest.jobs) {
    assert.equal(job.agent, "codex-cli");
    assert.equal(job.reasoning, EFFORT);
    assert.equal(job.state, "completed", `${job.key} agent state`);
    assert.equal(job.scheme_ok, true, `${job.key} round schema`);
    assert.equal(job.docker_routing_ok, true, `${job.key} Docker routing`);
    assert.equal(job.harness_state, "completed", `${job.key} harness state`);
    assert(
      [0, 1].includes(Number(job.harness_score)),
      `${job.key} harness score`,
    );
    assert(Number(job.round_count) > 0, `${job.key} LLM turns`);
    assert(Number(job.total_tokens) > 0, `${job.key} token usage`);
    assert(!keys.has(job.key), `duplicate run key: ${job.key}`);
    keys.add(job.key);
    tasks.add(job.task?.task_id);
    replicates.add(Number(job.replicate));
  }
  assert.equal(tasks.size, EXPECTED_TASKS);
  assert.deepEqual([...replicates].sort(), [1, 2, 3]);
  for (const batch of [1, 2, 3, 4])
    assert.equal(
      manifest.jobs.filter((job) => Number(job.batch_index) === batch).length,
      WORKER_CONCURRENCY,
      `batch ${batch} cardinality`,
    );
  return {
    taskCount: tasks.size,
    replicateCount: replicates.size,
    runCount: manifest.jobs.length,
    harnessCompleted: manifest.jobs.filter(
      (job) => job.harness_state === "completed",
    ).length,
  };
}

export function publishDeepSweCodexHigh(options) {
  const source = path.resolve(required(options.source, "--source"));
  const resultsRoot = path.resolve(
    options.resultsRoot || path.join(root, "results"),
  );
  const manifestPath = path.join(source, "manifest.json");
  const manifest = readJson(manifestPath);
  const sourceAudit = auditDeepSweCodexHighManifest(manifest);
  const selection = readJson(path.resolve(manifest.selection_path));
  assert.equal(selection?.schema, "tura.benchmark.deep-swe-selection.v1");
  assert.equal(selection.tasks?.length, EXPECTED_TASKS);
  assert.deepEqual(
    selection.tasks.map((task) => task.task_id),
    CANONICAL_TASK_IDS,
    "Codex High publication must use the pinned DeepSWE task set",
  );
  auditCodexSourceArtifacts(source, manifest);
  if (options.checkSourceOnly)
    return { ok: true, mode: "check-source", source, ...sourceAudit };

  const stagingRoot = path.join(
    resultsRoot,
    `.deepswe-codex-high-staging-${process.pid}`,
  );
  const stagingDebug = path.join(stagingRoot, "results", "debug");
  assertInside(resultsRoot, stagingRoot);
  assert(
    !fs.existsSync(stagingRoot),
    `staging path already exists: ${stagingRoot}`,
  );
  fs.mkdirSync(stagingDebug, { recursive: true });

  const reports = [];
  try {
    for (let replicate = 1; replicate <= EXPECTED_REPLICATES; replicate += 1) {
      reports.push(
        publishReplicate({
          source,
          manifest,
          selection,
          replicate,
          stagingDebug,
        }),
      );
    }
    const auditName = "deepswe-v1.1-gpt56-sol-codex-cli-high-audit.json";
    writeJson(path.join(stagingDebug, auditName), {
      schema: "tura.benchmark.deepswe-codex-high-normalization-audit.v1",
      source: slash(path.relative(root, manifestPath)),
      taskCount: EXPECTED_TASKS,
      agentCount: 1,
      replicateCount: EXPECTED_REPLICATES,
      runCount: EXPECTED_RUNS,
      taskBatchSize: TASK_BATCH_SIZE,
      workerConcurrency: WORKER_CONCURRENCY,
      reports: reports.map((report) => ({
        report: report.id,
        runs: report.runCount,
      })),
      schemaValidated: true,
      generatedAt: new Date().toISOString(),
    });

    validateStaging(stagingRoot);
    const destinationDebug = path.join(resultsRoot, "debug");
    fs.mkdirSync(destinationDebug, { recursive: true });
    for (const report of reports) {
      const from = path.join(stagingDebug, report.id);
      const to = path.join(destinationDebug, report.id);
      assert(
        !fs.existsSync(to),
        `refusing to overwrite published report: ${to}`,
      );
      publishDirectory(from, to);
    }
    const auditFrom = path.join(stagingDebug, auditName);
    const auditTo = path.join(destinationDebug, auditName);
    assert(
      !fs.existsSync(auditTo),
      `refusing to overwrite published audit: ${auditTo}`,
    );
    publishFile(auditFrom, auditTo);
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return {
      ok: true,
      mode: "publish",
      source,
      schemaValidated: true,
      reports,
      audit: slash(path.relative(root, auditTo)),
    };
  } catch (error) {
    error.message = `${error.message}\nstaging retained for audit: ${stagingRoot}`;
    throw error;
  }
}

export function publishDirectory(from, to) {
  const temporary = `${to}.publishing-${process.pid}`;
  assert(!fs.existsSync(temporary), `stale publish directory: ${temporary}`);
  fs.cpSync(from, temporary, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  renameWithRetry(temporary, to);
}

export function publishFile(from, to) {
  const temporary = `${to}.publishing-${process.pid}`;
  assert(!fs.existsSync(temporary), `stale publish file: ${temporary}`);
  fs.copyFileSync(from, temporary, fs.constants.COPYFILE_EXCL);
  renameWithRetry(temporary, to);
}

function renameWithRetry(from, to) {
  let lastError = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!new Set(["EPERM", "EBUSY", "EACCES"]).has(error?.code)) throw error;
      if (attempt < 10)
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          attempt * 50,
        );
    }
  }
  throw lastError;
}

function publishReplicate({
  source,
  manifest,
  selection,
  replicate,
  stagingDebug,
}) {
  const reportId = `report-deepswe-v1.1-gpt56-sol-codex-cli-high-r${String(replicate).padStart(2, "0")}`;
  const reportRoot = path.join(stagingDebug, reportId);
  const jobs = manifest.jobs
    .filter((job) => Number(job.replicate) === replicate)
    .sort((left, right) => left.task.task_id.localeCompare(right.task.task_id));
  assert.equal(jobs.length, EXPECTED_TASKS);
  const runs = [];
  const totals = {
    rounds: 0,
    messages: 0,
    inputMessages: 0,
    outputMessages: 0,
    commands: 0,
    toolCalls: 0,
  };
  for (const job of jobs) {
    const taskId = job.task.task_id;
    const task = selection.tasks.find((item) => item.task_id === taskId);
    assert(task, `selection is missing task: ${taskId}`);
    const taskRoot = path.join(reportRoot, taskId);
    writeTaskContracts(task, taskRoot);
    const runId = `${taskId}-${PUBLIC_AGENT_PATH}-run-${String(replicate).padStart(2, "0")}`;
    const runRoot = path.join(taskRoot, PUBLIC_AGENT_PATH, runId);
    const sourceRun = path.join(
      source,
      "runs",
      taskId,
      `codex-cli-r${replicate}`,
    );
    const published = publishRun({
      reportId,
      runId,
      runRoot,
      sourceRun,
      sourceBatch: manifest.run_id,
      task,
      job,
    });
    for (const key of Object.keys(totals)) totals[key] += published[key];
    runs.push({
      runId,
      taskId,
      agentId: PUBLIC_AGENT_ID,
      agent: PUBLIC_AGENT_PATH,
      effort: EFFORT,
      replicate,
      status: Number(job.harness_score) === 1 ? "pass" : "fail",
      rounds: published.rounds,
      commands: published.commands,
      path: slash(
        path.join(
          "results",
          "debug",
          reportId,
          taskId,
          PUBLIC_AGENT_PATH,
          runId,
        ),
      ),
    });
  }
  writeJson(path.join(reportRoot, "manifest.json"), {
    schema: "tura.benchmark.deepswe-local-batch.v1",
    id: reportId,
    category: "debug",
    benchmark: "datacurve-ai/deep-swe",
    benchmarkVersion: "v1.1",
    model: MODEL,
    replicate,
    taskCount: EXPECTED_TASKS,
    runCount: runs.length,
    agents: [PUBLIC_AGENT_ID],
    source: {
      manifest: slash(path.relative(root, path.join(source, "manifest.json"))),
      selection: slash(path.relative(root, manifest.selection_path)),
    },
    runs,
  });
  return {
    id: reportId,
    replicate,
    runCount: runs.length,
    passed: runs.filter((run) => run.status === "pass").length,
    failed: runs.filter((run) => run.status === "fail").length,
    ...totals,
  };
}

export function writeTaskContracts(task, taskRoot) {
  if (fs.existsSync(path.join(taskRoot, "task.json"))) return;
  const taskId = task.task_id;
  const corpusTaskRoot = path.join(root, "raw", "_cache", "deep-swe", taskId);
  const promptPath = path.join(corpusTaskRoot, "instruction.md");
  const tomlPath = path.join(corpusTaskRoot, "task.toml");
  assert(fs.existsSync(promptPath), `missing task prompt: ${promptPath}`);
  assert(fs.existsSync(tomlPath), `missing task declaration: ${tomlPath}`);
  const prompt = fs.readFileSync(promptPath, "utf8");
  const toml = fs.readFileSync(tomlPath, "utf8");
  const description =
    readTomlString(toml, "display_description") ||
    prompt.split(/\r?\n/).find((line) => line.trim()) ||
    task.display_title ||
    taskId;
  const location = (file, symbol = null) => ({
    repository: "https://github.com/datacurve-ai/deep-swe",
    commit: "v1.1",
    path: `tasks/${taskId}/${file}`,
    symbol,
    localPath: null,
  });
  const harness = {
    schema: "tura.benchmark.task-harness.v1",
    id: `${taskId}-deepswe-v1.1-harness`,
    codeLocation: location("tests/test.sh"),
    scoreItemCount: 1,
    scoreItems: [
      {
        id: "deepswe-verifier",
        name: "DeepSWE verifier",
        description:
          "Binary official DeepSWE reward: all fail-to-pass tests must pass and all pass-to-pass regression tests must remain passing.",
        category: "DeepSWE verifier",
        harnessCodeLocation: location("tests/grader.py", "main"),
        sourceLocation: location("tests/test.patch"),
      },
    ],
  };
  const taskContract = {
    schema: "tura.benchmark.task.v1",
    id: taskId,
    category: "debug",
    title: task.display_title || taskId,
    description,
    evaluation: { mode: "harness" },
    source: {
      language: task.language,
      repository: task.repository_url,
      commit: task.base_commit_hash,
      tag: "deep-swe-v1.1",
      codePath: ".",
    },
    target: {
      language: task.language,
      deliverable: "A repository patch satisfying the DeepSWE v1.1 verifier.",
    },
    taskDeclaration: {
      repository: "https://github.com/datacurve-ai/deep-swe",
      path: `tasks/${taskId}/task.toml`,
      localPath: null,
    },
    promptLocation: "task-first-round-prompt.txt",
    harness,
    contracts: {
      run: "tura.benchmark.web-run.v1",
      taskReport: "tura.benchmark.task-report.v1",
      harnessReport: "tura.benchmark.harness-report.v2",
    },
    official: {
      benchmark: "datacurve-ai/deep-swe",
      benchmarkVersion: "v1.1",
      taskPage: `https://deepswe.datacurve.ai/data/v1.1/tasks/${taskId}`,
      taskArtifact: `https://deepswe.datacurve.ai/artifacts/v1.1/tasks/${taskId}.json`,
      difficultyBand: task.difficulty_band,
      officialPassRate: task.official_pass_rate,
      officialScoredTrials: task.official_scored_trials,
      category: readTomlString(toml, "category"),
      dockerImage: task.docker_image,
    },
  };
  fs.mkdirSync(taskRoot, { recursive: true });
  writeJson(path.join(taskRoot, "task.json"), taskContract);
  writeJson(path.join(taskRoot, "harness.json"), harness);
  fs.writeFileSync(
    path.join(taskRoot, "task-first-round-prompt.txt"),
    prompt,
    "utf8",
  );
}

function readTomlString(toml, key) {
  const match = String(toml).match(
    new RegExp(`^${key}\\s*=\\s*(["'])(.*?)\\1\\s*$`, "m"),
  );
  return match?.[2] || null;
}

function publishRun({
  reportId,
  runId,
  runRoot,
  sourceRun,
  sourceBatch,
  task,
  job,
}) {
  const rawSummaryPath = path.join(sourceRun, "agent-summary.json");
  const rawHarnessPath = path.join(sourceRun, "harness", "report.json");
  const invocationPath = path.join(
    sourceRun,
    "context-and-calls",
    "invocation.json",
  );
  const rawSummary = readJson(rawSummaryPath);
  const rawHarness = readJson(rawHarnessPath);
  const invocation = readJson(invocationPath);
  assert.equal(rawSummary.reasoning, EFFORT);
  assert.equal(rawSummary.model, MODEL);
  assert.equal(Number(rawHarness.reward?.reward), Number(job.harness_score));
  assert.equal(rawHarness.model_patch_applied, true);
  assert.match(String(rawHarness.model_patch_sha256 || ""), /^[0-9a-f]{64}$/i);
  assert.equal(
    rawHarness.model_patch_sha256,
    sha256File(path.join(sourceRun, "model.patch")),
  );

  const metadataRoot = path.join(runRoot, "metadata");
  const contractsRoot = path.join(metadataRoot, "contracts");
  const roundsRoot = path.join(contractsRoot, "rounds");
  fs.mkdirSync(roundsRoot, { recursive: true });
  fs.copyFileSync(
    path.join(sourceRun, "prompt.md"),
    path.join(runRoot, "raw-first-round-prompt.txt"),
  );
  fs.copyFileSync(
    rawSummaryPath,
    path.join(metadataRoot, "source-agent-summary.json"),
  );
  fs.copyFileSync(
    rawHarnessPath,
    path.join(metadataRoot, "source-harness-report.json"),
  );
  fs.copyFileSync(
    invocationPath,
    path.join(metadataRoot, "source-invocation.json"),
  );
  copyOptional(
    path.join(sourceRun, "harness", "stdout.log"),
    path.join(metadataRoot, "harness.stdout.log"),
  );
  copyOptional(
    path.join(sourceRun, "harness", "stderr.log"),
    path.join(metadataRoot, "harness.stderr.log"),
  );
  fs.copyFileSync(
    path.join(sourceRun, "model.patch"),
    path.join(contractsRoot, "git-diff.patch"),
  );
  fs.cpSync(
    path.join(sourceRun, "harness"),
    path.join(metadataRoot, "harness"),
    {
      recursive: true,
    },
  );
  fs.cpSync(
    path.join(sourceRun, "workspace"),
    path.join(runRoot, "workspace"),
    {
      recursive: true,
    },
  );
  const workspaceRecovery = readJson(
    path.join(sourceRun, "workspace", ".benchmark-workspace.json"),
  );
  writeJson(
    path.join(metadataRoot, "workspace-recovery.json"),
    workspaceRecovery,
  );

  const rounds = rebuildRoundContracts({
    sourceRun,
    rawSummary,
    taskId: task.task_id,
  });
  assert.equal(
    rounds.length,
    Number(job.round_count),
    `${runId} LLM turn count`,
  );
  const commands = rounds.reduce(
    (total, round) => total + round.commands.length,
    0,
  );
  const usage = normalizeUsage(rawSummary.usage);
  const pricingOptions = {
    model: MODEL,
    serviceTier: "default",
    usage,
  };
  const pricingCalls = rawSummary.provider_calls?.length
    ? rawSummary.provider_calls
    : (rawSummary.rounds || []).map((round) => ({ usage: round.usage }));
  const pricing = pricingCalls.length
    ? costEstimateForProviderCalls(pricingCalls, pricingOptions)
    : costEstimateForUsage(usage, pricingOptions);
  const prompt = fs.readFileSync(path.join(sourceRun, "prompt.md"), "utf8");
  const patch = fs.readFileSync(path.join(sourceRun, "model.patch"), "utf8");
  const taskContract = readJson(path.join(runRoot, "..", "..", "task.json"));
  const harnessContract = readJson(
    path.join(runRoot, "..", "..", "harness.json"),
  );
  const passed = Number(rawHarness.reward.reward) === 1;
  const harnessReport = buildHarnessReport({
    runId,
    reportId,
    taskId: task.task_id,
    passed,
    rawHarness,
    rule: harnessContract.scoreItems[0],
  });
  const cliVersion = CODEX_CLI_VERSION;
  const cliMetadata = buildCliMetadata(invocation, cliVersion);
  const agentMetadata = buildAgentMetadata(cliVersion);
  const summary = {
    schema: "tura.benchmark.normalized-summary.v1",
    runId,
    taskId: task.task_id,
    agentId: PUBLIC_AGENT_ID,
    model: MODEL,
    effort: EFFORT,
    sourceBatch,
    elapsedMs: Number(rawSummary.elapsed_ms || 0),
    exitCode: rawSummary.exit_code,
    usage,
    events: { rounds: rounds.length, commands },
    patch: {
      bytes: Buffer.byteLength(patch),
      changedFiles: rawSummary.patch?.changed_files?.length || 0,
    },
  };
  const taskReport = {
    schema: "tura.benchmark.task-report.v1",
    runId,
    category: "debug",
    report: reportId,
    task: task.task_id,
    agent: PUBLIC_AGENT_ID,
    taskId: task.task_id,
    agentId: PUBLIC_AGENT_ID,
    result: {
      status: passed ? "pass" : "fail",
      score: passed ? 100 : 0,
      harness: {
        passed: passed ? 1 : 0,
        total: 1,
        failToPass: rewardBreakdown(rawHarness.reward, "f2p"),
        passToPass: rewardBreakdown(rawHarness.reward, "p2p"),
      },
    },
    source: {
      url: task.repository_url,
      model: MODEL,
      steps: rounds.length,
      costUsd: pricing.costUsd,
      pricing,
      inputTokens: usage.inputTokens,
      cacheInputTokens: usage.cacheInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      durationSeconds: Number(rawSummary.elapsed_ms || 0) / 1000,
      commands,
      rawArtifactStatus:
        "Normalized from the completed local DeepSWE Codex CLI High matrix after round, schema, Docker-routing, patch, and official verifier gates passed.",
    },
    prompt: {
      path: "raw-first-round-prompt.txt",
      format: "markdown",
      text: prompt,
    },
    metadata: {
      startedAt: job.started_at,
      endedAt: job.finished_at,
      agentVersion: cliVersion,
      agentCliCommand: [invocation.command, ...(invocation.args || [])].join(
        " ",
      ),
    },
    usage: { ...usage, llmRoundCount: rounds.length },
    harnessScore: passed ? 1 : 0,
    gitDiffPath: "metadata/contracts/git-diff.patch",
    harnessDirectory: "metadata/harness",
    cliMetadataPath: "metadata/contracts/cli-metadata.json",
    roundsDirectory: "metadata/contracts/rounds",
    rounds,
    sourceSummaryPath: slash(path.relative(root, rawSummaryPath)),
  };
  const webRun = buildWebRun({
    reportId,
    runId,
    taskContract,
    task,
    prompt,
    summary,
    pricing,
    rounds,
    harnessReport,
    agentMetadata,
    cliVersion,
    rawSummary,
  });

  writeJson(path.join(metadataRoot, "summary.json"), summary);
  writeJson(path.join(contractsRoot, "cli-metadata.json"), cliMetadata);
  writeJson(path.join(contractsRoot, "agent-metadata.json"), agentMetadata);
  writeJson(path.join(contractsRoot, "harness-report.json"), harnessReport);
  writeJson(path.join(contractsRoot, "task-report.json"), taskReport);
  writeJson(path.join(contractsRoot, "benchmark-web-run.json"), webRun);
  fs.writeFileSync(
    path.join(contractsRoot, "agent-rounds.jsonl"),
    `${rounds.map((round) => JSON.stringify(round)).join("\n")}\n`,
    "utf8",
  );
  const roundFiles = [];
  for (const [index, round] of rounds.entries()) {
    const name = `round-${String(index + 1).padStart(4, "0")}.json`;
    writeJson(path.join(roundsRoot, name), round);
    roundFiles.push(`metadata/contracts/rounds/${name}`);
  }
  writeJson(path.join(contractsRoot, "contract-manifest.json"), {
    schema: "tura.benchmark.contract-manifest.v1",
    runId,
    files: {
      run: "metadata/contracts/benchmark-web-run.json",
      taskReport: "metadata/contracts/task-report.json",
      agentRounds: "metadata/contracts/agent-rounds.jsonl",
      rounds: roundFiles,
      cliMetadata: "metadata/contracts/cli-metadata.json",
      harnessReport: "metadata/contracts/harness-report.json",
      taskContract: "../../task.json",
      harnessContract: "../../harness.json",
      agentMetadata: "metadata/contracts/agent-metadata.json",
      gitDiff: "metadata/contracts/git-diff.patch",
      workspace: "workspace",
    },
    naming: {
      runDirectory: "{task}-{agent}-run-{NN}",
      roundFile: "round-{NNNN}.json",
    },
  });
  return {
    rounds: rounds.length,
    messages: rounds.reduce((total, round) => total + round.messages.length, 0),
    inputMessages: rounds.reduce(
      (total, round) => total + round.input.messages.length,
      0,
    ),
    outputMessages: rounds.reduce(
      (total, round) => total + round.output.messages.length,
      0,
    ),
    commands,
    toolCalls: rounds.reduce(
      (total, round) => total + round.toolCalls.length,
      0,
    ),
  };
}

function rebuildRoundContracts({ sourceRun, rawSummary, taskId }) {
  const rolloutRoot = path.join(
    sourceRun,
    "context-and-calls",
    "codex-rollouts",
  );
  const rolloutPaths = fs
    .readdirSync(rolloutRoot)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(rolloutRoot, name));
  assert(rolloutPaths.length > 0, `${taskId} has no Codex rollout`);
  const rebuilt = buildAgentRoundContracts(
    {
      agent: "codex-cli",
      agent_id: PUBLIC_AGENT_ID,
      stdout_path: path.join(sourceRun, "stdout.jsonl"),
      context_archive: { codex_rollout_paths: rolloutPaths },
    },
    {
      model: MODEL,
      reasoning: EFFORT,
      service_tier: "default",
      priority_enabled: false,
      prompt: fs.readFileSync(path.join(sourceRun, "prompt.md"), "utf8"),
    },
  );
  assert.equal(
    rebuilt.length,
    rawSummary.rounds.length,
    `${taskId} rebuilt LLM turn count`,
  );
  return rebuilt.map((round, index) => {
    const messages = Array.isArray(round.messages) ? round.messages : [];
    const toolCalls = Array.isArray(round.toolCalls) ? round.toolCalls : [];
    const commands = toolCalls.map(commandFromToolCall);
    const normalized = {
      ...round,
      roundIndex: index + 1,
      input: {
        ...(round.input || {}),
        fullContext: String(round.input?.fullContext || ""),
        messages: Array.isArray(round.input?.messages)
          ? round.input.messages
          : [],
      },
      output: {
        ...(round.output || {}),
        fullOutput: String(round.output?.fullOutput || ""),
        assistantMessage: String(round.output?.assistantMessage || ""),
        messages: Array.isArray(round.output?.messages)
          ? round.output.messages
          : [],
      },
      messages,
      commands,
      toolCalls,
      usage: round.usage || {
        inputTokens: null,
        cacheInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      sources: round.sources || {},
      metadata: {
        ...(round.metadata || {}),
        agentId: PUBLIC_AGENT_ID,
        taskId,
        model: MODEL,
        reasoning: EFFORT,
        serviceTier: "default",
      },
    };
    assertRoundCompleteness(normalized, taskId);
    return normalized;
  });
}

export function commandFromToolCall(tool, index) {
  const args =
    tool?.arguments && typeof tool.arguments === "object" ? tool.arguments : {};
  const exitCode = Number.isInteger(args.exit_code) ? args.exit_code : null;
  const status =
    typeof args.status === "string" && args.status
      ? args.status
      : exitCode === 0
        ? "completed"
        : exitCode === null
          ? "unknown"
          : "failed";
  return {
    id: String(tool?.id || `command-${index + 1}`),
    toolName: String(tool?.name || tool?.kind || "tool"),
    type: String(tool?.name || tool?.kind || "tool"),
    isCommandRun: false,
    step: index + 1,
    commandRunStep: null,
    commandIndex: index,
    providerToolCallId: tool?.id || null,
    status,
    commandLine: String(tool?.commandLine || args.input || ""),
    preview: String(tool?.commandLine || args.input || "").split(/\r?\n/)[0],
    exitCode,
    durationMs: Number.isFinite(tool?.durationMs) ? tool.durationMs : null,
    durationSeconds: Number.isFinite(tool?.durationMs)
      ? tool.durationMs / 1000
      : null,
    receipt: String(
      args.receipt || args.aggregated_output || args.stdout || "",
    ),
    stdout: String(args.stdout || args.aggregated_output || ""),
    stderr: String(args.stderr || ""),
  };
}

export function assertRoundCompleteness(round, taskId) {
  const label = `${taskId} round ${round.roundIndex}`;
  assert.equal(
    round.schema,
    "tura.benchmark.agent-round.v1",
    `${label} schema`,
  );
  assert(round.roundId, `${label} roundId`);
  assert(Array.isArray(round.input.messages), `${label} input.messages`);
  assert(Array.isArray(round.output.messages), `${label} output.messages`);
  assert(Array.isArray(round.messages), `${label} messages`);
  assert(Array.isArray(round.commands), `${label} commands`);
  assert(Array.isArray(round.toolCalls), `${label} toolCalls`);
  assert.equal(
    round.commands.length,
    round.toolCalls.length,
    `${label} command cardinality`,
  );
  assert(round.usage && typeof round.usage === "object", `${label} usage`);
  assert(
    round.sources && typeof round.sources === "object",
    `${label} sources`,
  );
  assert(
    round.metadata && typeof round.metadata === "object",
    `${label} metadata`,
  );
  for (const command of round.commands) {
    assert(command.id, `${label} command.id`);
    assert.equal(
      typeof command.commandLine,
      "string",
      `${label} command.commandLine`,
    );
    assert.equal(typeof command.stdout, "string", `${label} command.stdout`);
    assert.equal(typeof command.stderr, "string", `${label} command.stderr`);
  }
}

function buildHarnessReport({
  runId,
  reportId,
  taskId,
  passed,
  rawHarness,
  rule,
}) {
  const result = {
    ...rule,
    status: passed ? "pass" : "fail",
    passed,
    failure: passed
      ? null
      : { message: "Official DeepSWE verifier returned reward 0." },
    breakdown: {
      failToPass: rewardBreakdown(rawHarness.reward, "f2p"),
      passToPass: rewardBreakdown(rawHarness.reward, "p2p"),
      partial: Number(rawHarness.reward?.partial || 0),
    },
  };
  return {
    schema: "tura.benchmark.harness-report.v2",
    id: `${runId}-harness-report`,
    runId,
    taskId,
    agentId: PUBLIC_AGENT_ID,
    category: "debug",
    report: reportId,
    taskContractPath: "../../task.json",
    harnessContractPath: "../../harness.json",
    status: passed ? "pass" : "fail",
    score: {
      passed: passed ? 1 : 0,
      failed: passed ? 0 : 1,
      total: 1,
      ratio: passed ? 1 : 0,
      label: passed ? "1/1" : "0/1",
    },
    results: [result],
    artifacts: {
      stdoutPath: "metadata/harness.stdout.log",
      stderrPath: "metadata/harness.stderr.log",
      harnessDirectory: "metadata/harness",
    },
    legacy: { sourceReport: rawHarness },
  };
}

function buildCliMetadata(invocation, version) {
  return {
    schema: "tura.benchmark.cli-metadata.v1",
    software: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      systemSoftwareVersion: `${os.type()} ${os.release()}`,
      packageName: "@openai/codex",
      packageVersion: version,
      gitHead: "",
    },
    agent: {
      agentId: PUBLIC_AGENT_ID,
      agentName: "Codex CLI",
      agentVersion: version,
      agentApplicationVersion: version,
      cliLaunchCommandName: path.basename(invocation.command || "codex"),
      cliCommand: [invocation.command, ...(invocation.args || [])].join(" "),
      pluginSkillGithubUrls: [],
      githubRepositoryUrl: "https://github.com/openai/codex",
      releasePageUrl: `https://github.com/openai/codex/releases/tag/rust-v${version}`,
      releaseDownloadUrl: null,
      releaseSha256: null,
      model: MODEL,
      effort: EFFORT,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildAgentMetadata(version) {
  return {
    schema: "tura.benchmark.agent-metadata.v1",
    id: PUBLIC_AGENT_ID,
    name: "Codex CLI GPT-5.6 SOL High",
    provider: "codex-cli",
    mode: "cli",
    model: MODEL,
    effort: EFFORT,
    version,
    runtime: {
      packageName: "@openai/codex",
      packageVersion: version,
      agentApplicationVersion: version,
      versionSource: "codex --version preflight and invocation metadata",
    },
  };
}

function buildWebRun({
  reportId,
  runId,
  taskContract,
  task,
  prompt,
  summary,
  pricing,
  rounds,
  harnessReport,
  agentMetadata,
  cliVersion,
  rawSummary,
}) {
  return {
    schema: "tura.benchmark.web-run.v1",
    id: runId,
    task: task.task_id,
    agent: PUBLIC_AGENT_ID,
    taskName: taskContract.title || task.task_id,
    sessionName: runId,
    title: `${taskContract.title || task.task_id} — Codex CLI High`,
    subtitle: "DeepSWE v1.1 official verifier run",
    prompt: { text: prompt, sourcePath: "raw-first-round-prompt.txt" },
    source: {
      url: task.repository_url,
      model: MODEL,
      steps: rounds.length,
      costUsd: pricing.costUsd,
      pricing,
      inputTokens: summary.usage.inputTokens,
      cacheInputTokens: summary.usage.cacheInputTokens,
      outputTokens: summary.usage.outputTokens,
      reasoningTokens: summary.usage.reasoningTokens,
      totalTokens: summary.usage.totalTokens,
      durationSeconds: summary.elapsedMs / 1000,
      commands: summary.events.commands,
      rawArtifactStatus:
        "Complete local Codex CLI High artifacts normalized after schema validation.",
    },
    run: {
      status: harnessReport.status,
      agent: "codex-cli",
      provider: "codex-cli",
      runtimeModel: MODEL,
      mode: "cli",
      startedAt: rawSummary.started_at || new Date().toISOString(),
      completedAt: rawSummary.finished_at || new Date().toISOString(),
      repository: task.repository_url,
      branch: task.base_commit_hash,
    },
    rounds,
    harness: harnessReport.results.map((result) => ({
      id: result.id,
      status: result.status,
      assertion: result.name,
      description: result.description,
      evidence: result.category,
      category: result.category,
      failure: result.failure,
      harnessCodeLocation: result.harnessCodeLocation,
      sourceLocation: result.sourceLocation,
    })),
    repoDiff: [],
    metadata: {
      common: {
        category: "debug",
        report: reportId,
        task: task.task_id,
        runId,
      },
      agent: agentMetadata,
      system: {
        platform: process.platform,
        arch: process.arch,
        operatingSystem: `${os.type()} ${os.release()}`,
        cliApplication: "@openai/codex",
        cliVersion,
      },
      environment: {
        operatingSystem: "Linux Docker container",
        architecture: process.arch,
        runtime: { language: task.language },
        browser: null,
      },
      custom: {
        benchmark: "datacurve-ai/deep-swe",
        benchmarkVersion: "v1.1",
        dockerImage: task.docker_image,
      },
      result_tab: "debug",
      result_tabs: [],
      contract_paths: {
        cliMetadataPath: "metadata/contracts/cli-metadata.json",
        taskReportPath: "metadata/contracts/task-report.json",
        harnessReportPath: "metadata/contracts/harness-report.json",
        roundsDirectory: "metadata/contracts/rounds",
        gitDiffPath: "metadata/contracts/git-diff.patch",
      },
    },
  };
}

export function normalizeUsage(usage = {}) {
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  return {
    inputTokens,
    cacheInputTokens: Number(usage.cached_input_tokens || 0),
    outputTokens,
    reasoningTokens: Number(usage.reasoning_tokens || 0),
    totalTokens: Number(usage.total_tokens || inputTokens + outputTokens),
  };
}

export function rewardBreakdown(reward = {}, prefix) {
  const total = Number(reward[`${prefix}_total`] || 0);
  const passed = Number(reward[`${prefix}_passed`] || 0);
  return { passed, failed: Math.max(0, total - passed), total };
}

export function validateStaging(stagingRoot) {
  const result = spawnSync(
    projectPython(root, process.env),
    [
      path.join(root, "schema", "validate.py"),
      "--benchmark-data",
      stagingRoot,
      "--tura-root",
      root,
      "--max-errors",
      "200",
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `published DeepSWE contracts failed schema validation\n${result.stdout}\n${result.stderr}`,
  );
}

function parseArgs(argv) {
  const result = { source: null, resultsRoot: null, checkSourceOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") result.source = argv[++index];
    else if (arg.startsWith("--source=")) result.source = arg.slice(9);
    else if (arg === "--results-root") result.resultsRoot = argv[++index];
    else if (arg.startsWith("--results-root="))
      result.resultsRoot = arg.slice(15);
    else if (arg === "--check-source") result.checkSourceOnly = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function copyOptional(from, to) {
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
}

function auditCodexSourceArtifacts(source, manifest) {
  for (const job of manifest.jobs) {
    const sourceRun = path.join(
      source,
      "runs",
      job.task.task_id,
      `codex-cli-r${job.replicate}`,
    );
    const summary = readJson(path.join(sourceRun, "agent-summary.json"));
    const harness = readJson(path.join(sourceRun, "harness", "report.json"));
    const patchPath = path.join(sourceRun, "model.patch");
    assert.equal(
      summary.round_contract_validation?.allLlmTurnsRecovered,
      true,
      `${job.key} all LLM turns`,
    );
    assert.equal(
      summary.rounds?.length,
      Number(job.round_count),
      `${job.key} round count`,
    );
    assert.equal(harness.model_patch_applied, true, `${job.key} patch applied`);
    assert.match(
      String(harness.model_patch_sha256 || ""),
      /^[0-9a-f]{64}$/i,
      `${job.key} patch sha256`,
    );
    assert.equal(
      harness.model_patch_sha256,
      sha256File(patchPath),
      `${job.key} applied patch hash`,
    );
  }
}

function sha256File(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function required(value, label) {
  assert(value, `${label} is required`);
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function assertInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
