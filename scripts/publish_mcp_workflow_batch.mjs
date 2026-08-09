#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { costEstimateForProviderCalls } from "../lib/business_paths.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
if (!args.rawRoot || !args.output) {
  throw new Error(
    "Usage: node scripts/publish_mcp_workflow_batch.mjs --raw-root <directory> --output <manifest.json>",
  );
}

const rawRoot = resolveInsideRepo(args.rawRoot, "raw root");
const outputPath = resolveInsideRepo(args.output, "output");
const publishRoot = path.dirname(outputPath);
const publishRelative = repoRelative(publishRoot);
if (!publishRelative.startsWith("results/mcp/")) {
  throw new Error("MCP workflow publication must stay below results/mcp/");
}
const temporaryRoot = path.join(
  path.dirname(publishRoot),
  `.${path.basename(publishRoot)}.tmp-${process.pid}`,
);
const taskReportPaths = findFiles(
  path.join(rawRoot, "runs"),
  "task-report.json",
);
if (taskReportPaths.length === 0) {
  throw new Error(`No task-report.json files found below ${rawRoot}`);
}

const batchSummaryPaths = jsonFiles(path.join(rawRoot, "batch-summaries"));
const cohortPaths = jsonFiles(path.join(rawRoot, "cohorts"));
if (batchSummaryPaths.length === 0 || cohortPaths.length === 0) {
  throw new Error(
    "A published batch requires batch summaries and cohort provenance",
  );
}

const batchSummaries = batchSummaryPaths.map(readJson);
const attempts = batchSummaries.flatMap((summary) => summary.attempts || []);
const attemptByRunId = new Map(
  attempts
    .map((attempt) => [attempt.job?.runId, attempt])
    .filter(([runId]) => runId),
);

const runRecords = taskReportPaths.map((taskReportPath) => {
  const taskReport = readJson(taskReportPath);
  const attemptDir = path.resolve(path.dirname(taskReportPath), "..", "..");
  const harnessPath = path.join(
    attemptDir,
    "metadata",
    "contracts",
    "harness-report.json",
  );
  const harness = readJson(harnessPath);
  const rounds = Array.isArray(taskReport.rounds) ? taskReport.rounds : [];
  const usages = rounds.map((round) => normalizedUsage(round.usage));
  const providerCalls = usages.map((usage) => ({ usage }));
  const metadataRows = rounds.map((round) => round.metadata || {});
  const attempt = attemptByRunId.get(taskReport.runId);
  const replicate = Number(
    attempt?.job?.replicate ?? /-r0*(\d+)$/.exec(taskReport.runId)?.[1],
  );
  if (!Number.isInteger(replicate) || replicate < 1) {
    throw new Error(`Cannot determine replicate for ${taskReport.runId}`);
  }

  const usage = sumUsage(usages);
  const cacheWriteTokens = sum(usages, "cacheWriteTokens");
  const uncachedInputTokens =
    usage.inputTokens - usage.cacheInputTokens - cacheWriteTokens;
  if (uncachedInputTokens < 0) {
    throw new Error(`Cached input exceeds input for ${taskReport.runId}`);
  }

  const model = uniqueRequired(
    metadataRows.map((row) => normalizeModel(row.model)).filter(Boolean),
    `model for ${taskReport.runId}`,
  );
  const serviceTier = uniqueRequired(
    metadataRows.map((row) => row.serviceTier).filter(Boolean),
    `service tier for ${taskReport.runId}`,
  );
  const estimate = costEstimateForProviderCalls(providerCalls, {
    model,
    serviceTier,
  });
  const naiveEstimate = costEstimateForProviderCalls(
    usages.map((usage) => ({ usage: { ...usage, cacheInputTokens: 0 } })),
    { model, serviceTier },
  );
  const startedAt = taskReport.metadata?.startedAt;
  const endedAt = taskReport.metadata?.endedAt;
  const publishedRunRoot = path.join(publishRoot, "runs", taskReport.runId);
  const publishedRunPath = repoRelative(publishedRunRoot);

  return {
    run: {
      runId: taskReport.runId,
      taskId: taskReport.taskId,
      agentId: taskReport.agentId,
      replicate,
      status: harness.status,
      score: harness.score,
      usage,
      uncachedInputTokens,
      cacheWriteTokens,
      requestCount: rounds.length,
      longContextRequestCount: estimate.longContextRequestCount,
      peakInputTokens: Math.max(0, ...usages.map((item) => item.inputTokens)),
      rounds: rounds.length,
      commands: rounds.reduce(
        (total, round) =>
          total + (round.commands || round.toolCalls || []).length,
        0,
      ),
      mcpToolCalls: integer(taskReport.mcp?.toolCallCount),
      durationMs: durationMs(startedAt, endedAt),
      costUsd: roundUsd(estimate.costUsd),
      artifactPath: publishedRunPath,
      artifacts: {
        task: `${publishedRunPath}/task.json`,
        workspace: `${publishedRunPath}/workspace`,
        rounds: `${publishedRunPath}/agent/rounds`,
        agentRounds: `${publishedRunPath}/agent/agent-rounds.jsonl`,
        stdout: `${publishedRunPath}/agent/stdout.jsonl`,
        providerCalls: `${publishedRunPath}/agent/context-and-calls/provider-calls-full.jsonl`,
        contracts: `${publishedRunPath}/metadata/contracts`,
        mcpTrace: `${publishedRunPath}/mcp/trace.jsonl`,
        mcpState: `${publishedRunPath}/mcp/state.json`,
        harness: `${publishedRunPath}/harness`,
        gitDiff: `${publishedRunPath}/git-diff.patch`,
        result: `${publishedRunPath}/result.json`,
      },
    },
    attemptDir,
    taskReport,
    harness,
    model,
    reasoning: uniqueRequired(
      metadataRows.map((row) => row.reasoning).filter(Boolean),
      `reasoning effort for ${taskReport.runId}`,
    ),
    serviceTier,
    estimate,
    naiveCostUsd: roundUsd(naiveEstimate.costUsd),
    startedAt,
    endedAt,
    failureClass: attempt?.failure_class || "evaluation",
  };
});

const batchTotal = sum(batchSummaries, "total");
if (batchTotal !== runRecords.length || attempts.length !== runRecords.length) {
  throw new Error(
    `Source mismatch: summaries=${batchTotal}, attempts=${attempts.length}, reports=${runRecords.length}`,
  );
}

const models = runRecords.map((record) => record.model);
const reasoningValues = runRecords.map((record) => record.reasoning);
const tierValues = runRecords.map((record) => record.serviceTier);
const model = uniqueRequired(models, "batch model");
const reasoning = uniqueRequired(reasoningValues, "batch reasoning effort");
const serviceTier = uniqueRequired(tierValues, "batch service tier");

const runs = runRecords
  .map((record) => record.run)
  .sort((a, b) =>
    [a.taskId, a.agentId, a.replicate]
      .join("/")
      .localeCompare([b.taskId, b.agentId, b.replicate].join("/")),
  );
const agents = [...new Set(runs.map((run) => run.agentId))].sort();
const tasks = [...new Set(runs.map((run) => run.taskId))].sort();
const replicates = [...new Set(runs.map((run) => run.replicate))].sort(
  (a, b) => a - b,
);
const usage = sumUsage(runs.map((run) => run.usage));
const uncachedInputTokens = sum(runs, "uncachedInputTokens");
const cacheWriteTokens = sum(runs, "cacheWriteTokens");
const costUsd = roundUsd(
  runRecords.reduce((total, record) => total + record.run.costUsd, 0),
);
const naiveUncachedCostUsd = roundUsd(
  runRecords.reduce((total, record) => total + record.naiveCostUsd, 0),
);
const passed = runs.filter((run) => run.status === "pass").length;
const failed = runs.length - passed;
const estimates = runRecords.map((record) => record.estimate);
const contexts = new Set(estimates.map((estimate) => estimate.context));
const firstEstimate = estimates[0];
const ratesPer1M = firstEstimate.ratesPer1M;
if (
  !ratesPer1M ||
  Object.keys(ratesPer1M).length === 0 ||
  contexts.size !== 1
) {
  throw new Error(
    "This publisher currently requires one pricing context/rate band",
  );
}

const startedAt = minTimestamp(runRecords.map((record) => record.startedAt));
const completedAt = maxTimestamp(runRecords.map((record) => record.endedAt));
const manifest = {
  schema: "tura.benchmark.mcp-workflow-batch.v1",
  schemaVersion: "1.1.0",
  id: path.basename(path.dirname(outputPath)),
  category: "mcp",
  benchmark: "tura/mcp-workflow",
  model,
  reasoning,
  serviceTier,
  generatedAt: completedAt,
  source: {
    rawRoot: repoRelative(rawRoot),
    publishedRoot: publishRelative,
    batchSummaries: batchSummaryPaths.map(repoRelative).sort(),
    cohorts: cohortPaths.map(repoRelative).sort(),
    startedAt,
    completedAt,
  },
  taskCount: tasks.length,
  replicateCount: replicates.length,
  runCount: runs.length,
  agents,
  outcome: {
    completed: runs.length,
    passed,
    failed,
    passRate: ratio(passed, runs.length),
  },
  usage,
  uncachedInputTokens,
  cacheWriteTokens,
  cacheHitRate: ratio(usage.cacheInputTokens, usage.inputTokens),
  pricing: {
    costUsd,
    naiveUncachedCostUsd,
    cacheSavingsUsd: roundUsd(naiveUncachedCostUsd - costUsd),
    currency: firstEstimate.currency,
    source: firstEstimate.source,
    model,
    tier: firstEstimate.tier,
    context: [...contexts][0],
    unit: firstEstimate.unit,
    ratesPer1M: {
      input: ratesPer1M.input,
      cachedInput: ratesPer1M.cachedInput,
      cacheWrite: ratesPer1M.cacheWrite,
      output: ratesPer1M.output,
    },
    billableTokens: {
      input: uncachedInputTokens,
      cachedInput: usage.cacheInputTokens,
      cacheWrite: cacheWriteTokens,
      output: usage.outputTokens,
      reasoning: usage.reasoningTokens,
      total: usage.totalTokens,
    },
    requestCount: sum(runs, "requestCount"),
    longContextRequestCount: sum(runs, "longContextRequestCount"),
    peakInputTokens: Math.max(...runs.map((run) => run.peakInputTokens)),
    note: "Estimated API-equivalent cost from official per-request OpenAI pricing. Reasoning tokens are a subset of output and are not charged twice; actual Codex subscription or OAuth billing may differ.",
  },
  agentSummaries: agents.map((id) =>
    aggregate(
      id,
      runs.filter((run) => run.agentId === id),
    ),
  ),
  taskSummaries: tasks.map((id) =>
    aggregate(
      id,
      runs.filter((run) => run.taskId === id),
    ),
  ),
  failures: runRecords
    .filter((record) => record.run.status === "fail")
    .map((record) => ({
      runId: record.run.runId,
      taskId: record.run.taskId,
      agentId: record.run.agentId,
      replicate: record.run.replicate,
      score: record.run.score,
      failureClass: record.failureClass,
      failedChecks: (record.harness.results || [])
        .filter((result) => !result.passed)
        .map((result) => ({
          id: result.id,
          message:
            result.failure?.message ||
            result.description ||
            "Harness check failed",
        })),
    }))
    .sort((a, b) => a.runId.localeCompare(b.runId)),
  runs,
  notes: [
    "Token totals are reconstructed from rounds[].usage because the legacy task-report usage aggregate records cacheInputTokens as zero even when round-level cache usage is present.",
    "cacheInputTokens is a subset of inputTokens, and reasoningTokens is a subset of outputTokens; neither subset is added again to totalTokens.",
    "Every run is self-contained below results/mcp with normalized rounds, provider calls, MCP trace and state, harness evidence, and its final workspace.",
    "Published workspaces exclude local .git metadata and .tura runtime databases; normalized rounds and provider artifacts retain the auditable model and command history.",
    "Raw artifacts remain unchanged under raw/ after publication.",
  ],
};

for (const failure of manifest.failures) {
  if (failure.failedChecks.length === 0) {
    throw new Error(`Failed run ${failure.runId} has no failed harness checks`);
  }
}

replaceDirectory(temporaryRoot);
for (const record of runRecords) {
  publishRunArtifacts(
    record,
    path.join(temporaryRoot, "runs", record.run.runId),
  );
}
fs.writeFileSync(
  path.join(temporaryRoot, path.basename(outputPath)),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
replacePublishedRoot(temporaryRoot, publishRoot);
process.stdout.write(
  `${repoRelative(outputPath)}: ${runs.length} runs, ${passed} passed, ${failed} failed, ${usage.totalTokens} tokens, $${costUsd.toFixed(6)}\n`,
);

function publishRunArtifacts(record, targetRoot) {
  const sourceRoot = record.attemptDir;
  const taskSource = path.join(
    repoRoot,
    "tasks",
    "mcp_workflow",
    record.run.taskId,
    "task.json",
  );
  copyRequiredFile(taskSource, path.join(targetRoot, "task.json"));
  copyWorkspace(
    path.join(sourceRoot, "workspace"),
    path.join(targetRoot, "workspace"),
  );

  const sourceRoundsRoot = path.join(sourceRoot, "agent", "rounds");
  const targetRoundsRoot = path.join(targetRoot, "agent", "rounds");
  const roundFiles = jsonFiles(sourceRoundsRoot).sort();
  if (roundFiles.length !== record.run.rounds) {
    throw new Error(
      `${record.run.runId} reports ${record.run.rounds} rounds but publishes ${roundFiles.length}`,
    );
  }
  const publishedRounds = roundFiles.map((source) => {
    const fileName = path.basename(source);
    const round = normalizePublishedRound(
      readJson(source),
      fileName,
      sourceRoot,
    );
    writeJson(path.join(targetRoundsRoot, fileName), round);
    return round;
  });
  writeJsonLines(
    path.join(targetRoot, "agent", "agent-rounds.jsonl"),
    publishedRounds,
  );

  copyPortableRequiredFile(
    path.join(sourceRoot, "agent", "stdout.jsonl"),
    path.join(targetRoot, "agent", "stdout.jsonl"),
    sourceRoot,
  );
  copyPortableOptionalFile(
    path.join(sourceRoot, "agent", "stderr.log"),
    path.join(targetRoot, "agent", "stderr.log"),
    sourceRoot,
  );
  copyPortableRequiredFile(
    path.join(
      sourceRoot,
      "agent",
      "context-and-calls",
      "provider-calls-full.jsonl",
    ),
    path.join(
      targetRoot,
      "agent",
      "context-and-calls",
      "provider-calls-full.jsonl",
    ),
    sourceRoot,
  );

  const contractsTarget = path.join(targetRoot, "metadata", "contracts");
  for (const name of [
    "cli-metadata.json",
    "contract-manifest.json",
    "harness-report.json",
  ]) {
    copyPortableRequiredFile(
      path.join(sourceRoot, "metadata", "contracts", name),
      path.join(contractsTarget, name),
      sourceRoot,
    );
  }
  const publishedTaskReport = {
    ...record.taskReport,
    startRepoSnapshot: {
      ...record.taskReport.startRepoSnapshot,
      repoRoot: "workspace",
      snapshotPath: "workspace",
    },
    rounds: publishedRounds,
  };
  writeJson(
    path.join(contractsTarget, "task-report.json"),
    normalizePortableValue(publishedTaskReport, sourceRoot),
  );

  for (const name of ["stdout.log", "stderr.log"]) {
    copyPortableOptionalFile(
      path.join(sourceRoot, "harness", name),
      path.join(targetRoot, "harness", name),
      sourceRoot,
    );
  }
  copyPortableRequiredFile(
    path.join(sourceRoot, "mcp", "trace.jsonl"),
    path.join(targetRoot, "mcp", "trace.jsonl"),
    sourceRoot,
  );
  copyPortableRequiredFile(
    path.join(sourceRoot, "mcp", "state.json"),
    path.join(targetRoot, "mcp", "state.json"),
    sourceRoot,
  );
  for (const name of ["git-diff.patch", "result.json", "run-directory.json"]) {
    copyPortableRequiredFile(
      path.join(sourceRoot, name),
      path.join(targetRoot, name),
      sourceRoot,
    );
  }
}

function normalizePublishedRound(round, fileName, sourceRoot) {
  return normalizePortableValue(
    {
      ...round,
      sources: {
        stdoutPath: "agent/stdout.jsonl",
        providerCallsPath: "agent/context-and-calls/provider-calls-full.jsonl",
        codexRolloutPath: null,
        providerLogPath: null,
        summaryPath: null,
      },
      rawCallbackPath: `agent/rounds/${fileName}`,
    },
    sourceRoot,
  );
}

function copyWorkspace(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Missing workspace: ${source}`);
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter(candidate) {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== ".git" && first !== ".tura";
    },
  });
}

function copyRequiredFile(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Missing artifact: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyPortableRequiredFile(source, target, sourceRoot) {
  if (!fs.existsSync(source)) throw new Error(`Missing artifact: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const contents = fs.readFileSync(source, "utf8");
  fs.writeFileSync(target, normalizePortableText(contents, sourceRoot), "utf8");
}

function copyPortableOptionalFile(source, target, sourceRoot) {
  if (fs.existsSync(source)) {
    copyPortableRequiredFile(source, target, sourceRoot);
  }
}

function normalizePortableValue(value, sourceRoot) {
  if (typeof value === "string") {
    return normalizePortableText(value, sourceRoot);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePortableValue(item, sourceRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizePortableValue(item, sourceRoot),
      ]),
    );
  }
  return value;
}

function normalizePortableText(value, sourceRoot) {
  const replacements = [
    [path.join(sourceRoot, "workspace"), "workspace"],
    [sourceRoot, "."],
    [repoRoot, "<benchmark-root>"],
    [os.homedir(), "<user-home>"],
  ];
  let normalized = value;
  for (const [localPath, portablePath] of replacements) {
    const variants = [
      localPath.replaceAll("\\", "\\\\"),
      localPath,
      localPath.replaceAll("\\", "/"),
    ];
    for (const variant of variants) {
      normalized = normalized.replaceAll(variant, portablePath);
    }
  }
  return normalized;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonLines(file, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    values.map((value) => JSON.stringify(value)).join("\n") + "\n",
    "utf8",
  );
}

function replaceDirectory(directory) {
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true });
  fs.mkdirSync(directory, { recursive: true });
}

function replacePublishedRoot(temporary, target) {
  const expectedParent = path.resolve(repoRoot, "results", "mcp");
  if (path.dirname(path.resolve(target)) !== expectedParent) {
    throw new Error(
      `Refusing to replace unexpected publication root: ${target}`,
    );
  }
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
  fs.renameSync(temporary, target);
}

function aggregate(id, selectedRuns) {
  const selectedUsage = sumUsage(selectedRuns.map((run) => run.usage));
  const selectedPassed = selectedRuns.filter(
    (run) => run.status === "pass",
  ).length;
  return {
    id,
    runCount: selectedRuns.length,
    passed: selectedPassed,
    failed: selectedRuns.length - selectedPassed,
    passRate: ratio(selectedPassed, selectedRuns.length),
    requestCount: sum(selectedRuns, "requestCount"),
    usage: selectedUsage,
    uncachedInputTokens: sum(selectedRuns, "uncachedInputTokens"),
    cacheWriteTokens: sum(selectedRuns, "cacheWriteTokens"),
    cacheHitRate: ratio(
      selectedUsage.cacheInputTokens,
      selectedUsage.inputTokens,
    ),
    averageTotalTokensPerRun: roundNumber(
      selectedUsage.totalTokens / selectedRuns.length,
      3,
    ),
    costUsd: roundUsd(
      selectedRuns.reduce((total, run) => total + run.costUsd, 0),
    ),
  };
}

function normalizedUsage(value = {}) {
  const usage = {
    inputTokens: integer(value.inputTokens),
    cacheInputTokens: integer(value.cacheInputTokens),
    outputTokens: integer(value.outputTokens),
    reasoningTokens: integer(value.reasoningTokens),
    totalTokens: integer(value.totalTokens),
    cacheWriteTokens: integer(value.cacheWriteTokens),
  };
  const canonicalTotal = usage.inputTokens + usage.outputTokens;
  if (usage.totalTokens !== 0 && usage.totalTokens !== canonicalTotal) {
    throw new Error(`Non-canonical token total: ${JSON.stringify(value)}`);
  }
  usage.totalTokens = canonicalTotal;
  return usage;
}

function sumUsage(rows) {
  const usage = {
    inputTokens: 0,
    cacheInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
  for (const row of rows) {
    for (const key of Object.keys(usage)) usage[key] += integer(row[key]);
  }
  return usage;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + integer(row?.[key]), 0);
}

function integer(value) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Expected non-negative safe integer, received ${value}`);
  }
  return number;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : roundNumber(numerator / denominator, 9);
}

function roundUsd(value) {
  return roundNumber(Number(value || 0), 6);
}

function roundNumber(value, places) {
  return Number(Number(value).toFixed(places));
}

function durationMs(start, end) {
  const value = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid duration ${start}..${end}`);
  return value;
}

function minTimestamp(values) {
  return new Date(
    Math.min(...values.map((value) => Date.parse(value))),
  ).toISOString();
}

function maxTimestamp(values) {
  return new Date(
    Math.max(...values.map((value) => Date.parse(value))),
  ).toISOString();
}

function normalizeModel(value) {
  return String(value || "").replace(/^openai\//, "");
}

function uniqueRequired(values, label) {
  const unique = [...new Set(values)];
  if (unique.length !== 1)
    throw new Error(`Expected one ${label}; found ${unique.join(", ")}`);
  return unique[0];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--raw-root") parsed.rawRoot = value;
    else if (key === "--output") parsed.output = value;
    else throw new Error(`Unknown argument: ${key}`);
    index += 1;
  }
  return parsed;
}

function findFiles(directory, fileName) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(target, fileName);
    return entry.isFile() && entry.name === fileName ? [target] : [];
  });
}

function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveInsideRepo(value, label) {
  const resolved = path.resolve(repoRoot, value);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${repoRoot}`);
  }
  return resolved;
}

function repoRelative(value) {
  const relative = path.relative(repoRoot, path.resolve(value));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside repository: ${value}`);
  }
  return relative.split(path.sep).join("/");
}
