#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  costEstimateForProviderCalls,
  costEstimateForUsage,
} from "../lib/business_paths.mjs";
import {
  assertRoundCompleteness,
  commandFromToolCall,
  normalizeUsage,
  publishDirectory,
  publishFile,
  rewardBreakdown,
  validateStaging,
  writeTaskContracts,
} from "./publish_deepswe_codex_high.mjs";
import { reconcileGenericAgentProviderRounds } from "../lib/generic_agent_cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "gpt-5.6-sol";
const RAW_TURA_MODEL = "openai/gpt-5.6-sol";
const EFFORT = "high";
const EXPECTED_TASKS = 20;
const EXPECTED_RUNS = 40;
const TASK_BATCH_SIZE = 5;
const DOCKER_CONCURRENCY = 5;
const AGENT_CONCURRENCY = 10;
const AGENTS = ["balanced", "direct"];
const TURA_VERSION = "v0.1.33-9-gde447ae7";
const TURA_GIT_HEAD = "de447ae71684064490773473f92cf2bb32b981d6";

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const receipt = publishDeepSweTuraPair({
    source: args.source,
    resultsRoot: args.resultsRoot,
    checkSourceOnly: args.checkSourceOnly,
  });
  console.log(JSON.stringify(receipt, null, 2));
}

export function auditDeepSweTuraPairManifest(manifest) {
  assert.equal(manifest?.schema, "tura.benchmark.deep-swe-matrix.v1");
  assert.equal(manifest?.benchmark, "datacurve-ai/deep-swe");
  assert.equal(manifest?.benchmark_version, "v1.1");
  assert.equal(manifest?.tura_model, RAW_TURA_MODEL);
  assert.equal(manifest?.tura_reasoning, EFFORT);
  assert.equal(manifest?.shared_tura_task_containers, true);
  assert.equal(manifest?.concurrency, DOCKER_CONCURRENCY);
  assert.equal(manifest?.task_batch_size, TASK_BATCH_SIZE);
  assert.equal(manifest?.task_batch_count, 4);
  assert.equal(manifest?.runs_per_task_batch, AGENT_CONCURRENCY);
  assert.equal(manifest?.task_batches_are_sequential, true);
  assert.equal(manifest?.docker_concurrency, DOCKER_CONCURRENCY);
  assert.equal(manifest?.agent_worker_capacity, AGENT_CONCURRENCY);
  assert.equal(manifest?.planned_agent_runs, EXPECTED_RUNS);
  assert.equal(manifest?.planned_harness_runs, EXPECTED_RUNS);
  assert.equal(manifest?.phase, "completed");
  assert(Array.isArray(manifest.jobs), "DeepSWE manifest.jobs is required");
  assert.equal(manifest.jobs.length, EXPECTED_RUNS);

  const keys = new Set();
  const tasks = new Set();
  const agents = new Set();
  for (const job of manifest.jobs) {
    assert(AGENTS.includes(job.agent), `${job.key} agent`);
    assert.equal(Number(job.replicate), 1, `${job.key} replicate`);
    assert.equal(job.reasoning, EFFORT, `${job.key} reasoning`);
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
    agents.add(job.agent);
  }
  assert.equal(tasks.size, EXPECTED_TASKS);
  assert.deepEqual([...agents].sort(), [...AGENTS].sort());
  for (const batch of [1, 2, 3, 4]) {
    assert.equal(
      manifest.jobs.filter((job) => Number(job.batch_index) === batch).length,
      AGENT_CONCURRENCY,
      `batch ${batch} cardinality`,
    );
  }
  return {
    taskCount: tasks.size,
    agentCount: agents.size,
    runCount: manifest.jobs.length,
    harnessCompleted: manifest.jobs.filter(
      (job) => job.harness_state === "completed",
    ).length,
  };
}

export function publishDeepSweTuraPair(options) {
  const source = path.resolve(required(options.source, "--source"));
  const resultsRoot = path.resolve(
    options.resultsRoot || path.join(root, "results"),
  );
  const manifestPath = path.join(source, "manifest.json");
  const manifest = readJson(manifestPath);
  const sourceAudit = auditDeepSweTuraPairManifest(manifest);
  const selection = readJson(path.resolve(manifest.selection_path));
  assert.equal(selection?.schema, "tura.benchmark.deep-swe-selection.v1");
  assert.equal(selection.tasks?.length, EXPECTED_TASKS);
  assert.equal(
    new Set(selection.tasks.map((task) => task.task_id)).size,
    EXPECTED_TASKS,
  );
  auditSourceArtifacts(source, manifest);
  if (options.checkSourceOnly) {
    return { ok: true, mode: "check-source", source, ...sourceAudit };
  }

  const stagingRoot = path.join(
    resultsRoot,
    `.deepswe-tura-pair-staging-${process.pid}`,
  );
  const stagingDebug = path.join(stagingRoot, "results", "debug");
  assertInside(resultsRoot, stagingRoot);
  assert(
    !fs.existsSync(stagingRoot),
    `staging path already exists: ${stagingRoot}`,
  );
  fs.mkdirSync(stagingDebug, { recursive: true });

  const reportId = "report-deepswe-v1.1-gpt56-sol-tura-pair-high-r01";
  const auditName = "deepswe-v1.1-gpt56-sol-tura-pair-high-audit.json";
  try {
    const report = publishReport({
      source,
      manifest,
      selection,
      stagingDebug,
      reportId,
    });
    writeJson(path.join(stagingDebug, auditName), {
      schema: "tura.benchmark.deepswe-tura-pair-normalization-audit.v1",
      source: slash(path.relative(root, manifestPath)),
      taskCount: EXPECTED_TASKS,
      agentCount: AGENTS.length,
      replicateCount: 1,
      runCount: EXPECTED_RUNS,
      taskBatchSize: TASK_BATCH_SIZE,
      dockerConcurrency: DOCKER_CONCURRENCY,
      agentConcurrency: AGENT_CONCURRENCY,
      sharedTaskContainers: true,
      harnessPassed: report.passed,
      harnessFailed: report.failed,
      harnessPassRate: report.passed / EXPECTED_RUNS,
      llmRounds: report.rounds,
      messages: report.messages,
      inputMessages: report.inputMessages,
      outputMessages: report.outputMessages,
      commands: report.commands,
      toolCalls: report.toolCalls,
      usage: {
        inputTokens: report.inputTokens,
        cacheInputTokens: report.cacheInputTokens,
        outputTokens: report.outputTokens,
        reasoningTokens: report.reasoningTokens,
        totalTokens: report.totalTokens,
      },
      costUsd: report.costUsd,
      agents: report.agents,
      allRoundContractFieldsPresent: true,
      report: report.id,
      schemaValidated: true,
      generatedAt: new Date().toISOString(),
    });
    validateStaging(stagingRoot);
    const destinationDebug = path.join(resultsRoot, "debug");
    fs.mkdirSync(destinationDebug, { recursive: true });
    const reportTo = path.join(destinationDebug, reportId);
    const auditTo = path.join(destinationDebug, auditName);
    assert(
      !fs.existsSync(reportTo),
      `refusing to overwrite published report: ${reportTo}`,
    );
    assert(
      !fs.existsSync(auditTo),
      `refusing to overwrite published audit: ${auditTo}`,
    );
    publishDirectory(path.join(stagingDebug, reportId), reportTo);
    publishFile(path.join(stagingDebug, auditName), auditTo);
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return {
      ok: true,
      mode: "publish",
      source,
      schemaValidated: true,
      report,
      audit: slash(path.relative(root, auditTo)),
    };
  } catch (error) {
    error.message = `${error.message}\nstaging retained for audit: ${stagingRoot}`;
    throw error;
  }
}

function auditSourceArtifacts(source, manifest) {
  for (const job of manifest.jobs) {
    const sourceRun = sourceRunPath(source, job);
    const summary = readJson(path.join(sourceRun, "agent-summary.json"));
    const harness = readJson(path.join(sourceRun, "harness", "report.json"));
    assert.equal(
      summary.round_contract_validation?.ok,
      true,
      `${job.key} round validation`,
    );
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
      sha256File(path.join(sourceRun, "model.patch")),
      `${job.key} applied patch hash`,
    );
    assert.equal(
      Number(harness.reward?.reward),
      Number(job.harness_score),
      `${job.key} reward`,
    );
    assert(
      fs.existsSync(path.join(sourceRun, "model.patch")),
      `${job.key} patch`,
    );
  }
}

function publishReport({
  source,
  manifest,
  selection,
  stagingDebug,
  reportId,
}) {
  const reportRoot = path.join(stagingDebug, reportId);
  const jobs = [...manifest.jobs].sort(
    (left, right) =>
      left.task.task_id.localeCompare(right.task.task_id) ||
      left.agent.localeCompare(right.agent),
  );
  const runs = [];
  const totals = {
    rounds: 0,
    messages: 0,
    inputMessages: 0,
    outputMessages: 0,
    commands: 0,
    toolCalls: 0,
    inputTokens: 0,
    cacheInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
  const agentTotals = new Map(
    AGENTS.map((agent) => [
      agent,
      {
        agent,
        runs: 0,
        harnessPassed: 0,
        harnessFailed: 0,
        llmRounds: 0,
        messages: 0,
        inputMessages: 0,
        outputMessages: 0,
        commands: 0,
        toolCalls: 0,
        usage: {
          inputTokens: 0,
          cacheInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        },
        costUsd: 0,
      },
    ]),
  );
  for (const job of jobs) {
    const taskId = job.task.task_id;
    const task = selection.tasks.find((item) => item.task_id === taskId);
    assert(task, `selection is missing task: ${taskId}`);
    const taskRoot = path.join(reportRoot, taskId);
    writeTaskContracts(task, taskRoot);
    const profile = agentProfile(job.agent);
    const runId = `${taskId}-${profile.path}-run-01`;
    const runRoot = path.join(taskRoot, profile.path, runId);
    const published = publishRun({
      reportId,
      runId,
      runRoot,
      sourceRun: sourceRunPath(source, job),
      sourceBatch: manifest.run_id,
      task,
      job,
      profile,
    });
    for (const key of Object.keys(totals)) totals[key] += published[key];
    const agentTotal = agentTotals.get(job.agent);
    agentTotal.runs += 1;
    agentTotal.harnessPassed += Number(job.harness_score) === 1 ? 1 : 0;
    agentTotal.harnessFailed += Number(job.harness_score) === 1 ? 0 : 1;
    agentTotal.llmRounds += published.rounds;
    agentTotal.messages += published.messages;
    agentTotal.inputMessages += published.inputMessages;
    agentTotal.outputMessages += published.outputMessages;
    agentTotal.commands += published.commands;
    agentTotal.toolCalls += published.toolCalls;
    agentTotal.usage.inputTokens += published.inputTokens;
    agentTotal.usage.cacheInputTokens += published.cacheInputTokens;
    agentTotal.usage.outputTokens += published.outputTokens;
    agentTotal.usage.reasoningTokens += published.reasoningTokens;
    agentTotal.usage.totalTokens += published.totalTokens;
    agentTotal.costUsd += published.costUsd;
    runs.push({
      runId,
      taskId,
      agentId: profile.publicId,
      agent: profile.path,
      effort: EFFORT,
      replicate: 1,
      status: Number(job.harness_score) === 1 ? "pass" : "fail",
      rounds: published.rounds,
      commands: published.commands,
      path: slash(
        path.join("results", "debug", reportId, taskId, profile.path, runId),
      ),
    });
  }
  assert.equal(runs.length, EXPECTED_RUNS);
  writeJson(path.join(reportRoot, "manifest.json"), {
    schema: "tura.benchmark.deepswe-local-batch.v1",
    id: reportId,
    category: "debug",
    benchmark: "datacurve-ai/deep-swe",
    benchmarkVersion: "v1.1",
    model: MODEL,
    replicate: 1,
    taskCount: EXPECTED_TASKS,
    runCount: runs.length,
    agents: AGENTS.map((agent) => agentProfile(agent).publicId),
    source: {
      manifest: slash(path.relative(root, path.join(source, "manifest.json"))),
      selection: slash(path.relative(root, manifest.selection_path)),
    },
    runs,
  });
  return {
    id: reportId,
    replicate: 1,
    runCount: runs.length,
    passed: runs.filter((run) => run.status === "pass").length,
    failed: runs.filter((run) => run.status === "fail").length,
    ...totals,
    costUsd: roundUsd(totals.costUsd),
    agents: [...agentTotals.values()].map((item) => ({
      ...item,
      costUsd: roundUsd(item.costUsd),
    })),
  };
}

function publishRun({
  reportId,
  runId,
  runRoot,
  sourceRun,
  sourceBatch,
  task,
  job,
  profile,
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
  assert.equal(rawSummary.model, RAW_TURA_MODEL);
  assert.equal(rawSummary.agent_mode, profile.mode);
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
    { recursive: true },
  );
  fs.cpSync(
    path.join(sourceRun, "workspace"),
    path.join(runRoot, "workspace"),
    { recursive: true },
  );
  const workspaceRecovery = readJson(
    path.join(sourceRun, "workspace", ".benchmark-workspace.json"),
  );
  writeJson(
    path.join(metadataRoot, "workspace-recovery.json"),
    workspaceRecovery,
  );

  const providerCalls = readProviderLogCalls(sourceRun);
  const rounds = normalizeRounds(
    rawSummary.rounds,
    task.task_id,
    profile,
    providerCalls,
  );
  assert.equal(
    rounds.length,
    Number(job.round_count),
    `${runId} LLM turn count`,
  );
  const expectedLlmTurns = providerCalls.length
    ? providerCalls.length
    : Number(rawSummary.round_contract_validation.expectedLlmRounds);
  assert.equal(rounds.length, expectedLlmTurns, `${runId} expected LLM turns`);
  const commands = rounds.reduce(
    (total, round) => total + round.commands.length,
    0,
  );
  assert.equal(
    commands,
    rounds.reduce((total, round) => total + round.toolCalls.length, 0),
  );
  const usage = normalizeUsage(rawSummary.usage);
  const pricingOptions = {
    model: MODEL,
    serviceTier: "default",
    usage,
  };
  const pricingCalls = providerCalls.length
    ? providerCalls
    : rawSummary.provider_calls;
  const pricing = pricingCalls?.length
    ? costEstimateForProviderCalls(pricingCalls, pricingOptions)
    : costEstimateForUsage(usage, pricingOptions);
  const prompt = fs.readFileSync(path.join(sourceRun, "prompt.md"), "utf8");
  const patch = fs.readFileSync(path.join(sourceRun, "model.patch"), "utf8");
  const startedAt = rounds[0]?.startedAt || job.started_at;
  const completedAt = rounds.at(-1)?.endedAt || job.finished_at;
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
    profile,
  });
  const cliMetadata = buildCliMetadata(invocation, profile);
  const agentMetadata = buildAgentMetadata(profile);
  const summary = {
    schema: "tura.benchmark.normalized-summary.v1",
    runId,
    taskId: task.task_id,
    agentId: profile.publicId,
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
    agent: profile.publicId,
    taskId: task.task_id,
    agentId: profile.publicId,
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
    source: sourceMetrics(
      task,
      rawSummary,
      usage,
      pricing,
      rounds.length,
      commands,
    ),
    prompt: {
      path: "raw-first-round-prompt.txt",
      format: "markdown",
      text: prompt,
    },
    metadata: {
      startedAt,
      endedAt: completedAt,
      agentVersion: TURA_VERSION,
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
  const taskContract = readJson(path.join(runRoot, "..", "..", "task.json"));
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
    rawSummary,
    startedAt,
    completedAt,
    profile,
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
    inputTokens: usage.inputTokens,
    cacheInputTokens: usage.cacheInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    costUsd: Number(pricing.costUsd || 0),
  };
}

export function normalizeRounds(
  rawRounds,
  taskId,
  profile,
  providerCalls = [],
) {
  assert(
    Array.isArray(rawRounds) && rawRounds.length > 0,
    `${taskId} has no LLM rounds`,
  );
  const providerCallsById = new Map(
    providerCalls
      .filter((call) => call?.call_id)
      .map((call) => [String(call.call_id), call]),
  );
  const reconciledRounds = reconcileGenericAgentProviderRounds(
    rawRounds,
    providerCalls,
  );
  return reconciledRounds.map((round, index) => {
    const toolCalls = Array.isArray(round.toolCalls) ? round.toolCalls : [];
    const providerCall = providerCallsById.get(String(round.roundId || ""));
    const providerUsage =
      providerCall?.usage ||
      providerCall?.metrics?.usage ||
      providerCall?.response?.usage ||
      null;
    const usageUnavailable = Boolean(providerCall) && !providerUsage;
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
      messages: Array.isArray(round.messages) ? round.messages : [],
      commands: toolCalls.map(commandFromToolCall),
      toolCalls,
      usage: round.usage,
      sources: round.sources || {},
      metadata: {
        ...(round.metadata || {}),
        agentId: profile.publicId,
        taskId,
        agentKind: "tura",
        agentMode: profile.mode,
        model: MODEL,
        reasoning: EFFORT,
        serviceTier: "default",
        priorityEnabled: false,
        usageUnavailable,
        providerSuccess: providerCall
          ? providerCall.success !== false
          : (round.metadata?.providerSuccess ?? null),
        providerError:
          providerCall?.error ||
          providerCall?.metrics?.error ||
          round.metadata?.providerError ||
          null,
      },
    };
    assertRoundCompleteness(normalized, taskId);
    return normalized;
  });
}

export function readProviderLogCalls(sourceRun) {
  const logRoot = path.join(sourceRun, "provider-log");
  if (!fs.existsSync(logRoot)) return [];
  const files = [];
  const stack = [logRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(file);
    }
  }
  const calls = [];
  const seen = new Set();
  for (const file of files.sort()) {
    let call;
    try {
      call = readJson(file);
    } catch {
      continue;
    }
    if (call?.type !== "llm_call") continue;
    const key = String(call.call_id || file);
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(call);
  }
  return calls.sort((left, right) =>
    String(left.started_at || "").localeCompare(String(right.started_at || "")),
  );
}

function sourceMetrics(task, rawSummary, usage, pricing, steps, commands) {
  return {
    url: task.repository_url,
    model: MODEL,
    steps,
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
      "Normalized from the completed Tura balanced/direct shared-container matrix after all LLM turns, schema, Docker-routing, applied-patch, and official verifier gates passed.",
  };
}

function buildHarnessReport({
  runId,
  reportId,
  taskId,
  passed,
  rawHarness,
  rule,
  profile,
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
    agentId: profile.publicId,
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

function buildCliMetadata(invocation, profile) {
  return {
    schema: "tura.benchmark.cli-metadata.v1",
    software: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      systemSoftwareVersion: `${os.type()} ${os.release()}`,
      packageName: "tura-ai",
      packageVersion: TURA_VERSION,
      gitHead: TURA_GIT_HEAD,
    },
    agent: {
      agentId: profile.publicId,
      agentName: profile.name,
      agentVersion: TURA_VERSION,
      agentApplicationVersion: TURA_VERSION,
      cliLaunchCommandName: path.basename(invocation.command || "tura"),
      cliCommand: [invocation.command, ...(invocation.args || [])].join(" "),
      pluginSkillGithubUrls: [],
      githubRepositoryUrl: "https://github.com/Tura-AI/tura",
      releasePageUrl: "https://github.com/Tura-AI/tura/releases",
      releaseDownloadUrl: null,
      releaseSha256: null,
      model: MODEL,
      effort: EFFORT,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildAgentMetadata(profile) {
  return {
    schema: "tura.benchmark.agent-metadata.v1",
    id: profile.publicId,
    name: `${profile.name} GPT-5.6 SOL High`,
    provider: "tura",
    mode: profile.mode,
    model: MODEL,
    effort: EFFORT,
    version: TURA_VERSION,
    runtime: {
      name: "tura",
      version: TURA_VERSION,
      repository: "https://github.com/Tura-AI/tura",
      gitHead: TURA_GIT_HEAD,
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
  rawSummary,
  startedAt,
  completedAt,
  profile,
}) {
  return {
    schema: "tura.benchmark.web-run.v1",
    id: runId,
    task: task.task_id,
    agent: profile.publicId,
    taskName: taskContract.title || task.task_id,
    sessionName: runId,
    title: `${taskContract.title || task.task_id} — ${profile.name} High`,
    subtitle: "DeepSWE v1.1 official verifier run",
    prompt: { text: prompt, sourcePath: "raw-first-round-prompt.txt" },
    source: sourceMetrics(
      task,
      rawSummary,
      summary.usage,
      pricing,
      rounds.length,
      summary.events.commands,
    ),
    run: {
      status: harnessReport.status,
      agent: profile.path,
      provider: "tura",
      runtimeModel: MODEL,
      mode: profile.mode,
      startedAt,
      completedAt,
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
        cliApplication: "tura",
        cliVersion: TURA_VERSION,
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
        sharedTaskContainer: true,
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

function agentProfile(agent) {
  assert(AGENTS.includes(agent), `unsupported Tura agent: ${agent}`);
  return {
    mode: agent,
    path: `tura-${agent}`,
    publicId: `tura-${agent}-gpt5.6-sol-high`,
    name: `Tura ${agent[0].toUpperCase()}${agent.slice(1)}`,
  };
}

function sourceRunPath(source, job) {
  return path.join(
    source,
    "runs",
    job.task.task_id,
    `${job.agent}-r${job.replicate}`,
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
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return result;
}

function copyOptional(from, to) {
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
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
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${child} is outside ${parent}`,
  );
}

function roundUsd(value) {
  return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}
