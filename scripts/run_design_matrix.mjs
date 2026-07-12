#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { benchmarkRawRoot } from "../lib/business_paths.mjs";
import { parseGenericAgents } from "../lib/generic_agent_cli.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const taskRoot = path.join(repoRoot, "tasks", "design");
const agents = parseGenericAgents(
  process.env.COMMAND_RUN_DESIGN_MATRIX_AGENTS,
  "direct,codex-cli",
);
const selectedTasks = selectTasks(process.env.COMMAND_RUN_DESIGN_MATRIX_TASKS);
const defaultReplicates = positiveInteger(
  process.env.COMMAND_RUN_DESIGN_MATRIX_DEFAULT_REPLICATES || 1,
  "default replicate count",
);
const replicateOverrides = parseReplicateOverrides(
  process.env.COMMAND_RUN_DESIGN_MATRIX_REPLICATES_BY_TASK,
);
const concurrency = positiveInteger(
  process.env.COMMAND_RUN_DESIGN_MATRIX_CONCURRENCY || 4,
  "matrix concurrency",
);
const monitorMs =
  Math.max(
    10,
    Number(process.env.COMMAND_RUN_DESIGN_MATRIX_MONITOR_SECONDS || 120),
  ) * 1000;
const stamp = process.env.COMMAND_RUN_DESIGN_MATRIX_STAMP || timestamp();
const matrixRoot = path.join(benchmarkRawRoot(), "design", "_matrix", stamp);
const progressPath =
  process.env.COMMAND_RUN_DESIGN_MATRIX_PROGRESS_PATH ||
  path.join(matrixRoot, "progress.md");
const manifestPath = path.join(matrixRoot, "matrix-manifest.json");
const summaryPath = path.join(matrixRoot, "matrix-summary.json");
const logRoot = path.join(matrixRoot, "logs");
const startedAt = new Date().toISOString();

fs.mkdirSync(logRoot, { recursive: true });
const jobs = buildJobs();
assert(jobs.length > 0, "design matrix selected no jobs");
writeJson(manifestPath, {
  schema: "tura.benchmark.design-matrix.v1",
  stamp,
  agents,
  tasks: selectedTasks,
  defaultReplicates,
  replicateOverrides: Object.fromEntries(replicateOverrides),
  concurrency,
  monitorIntervalMs: monitorMs,
  model: process.env.COMMAND_RUN_AGENT_CODEX_MODEL,
  turaModel: process.env.COMMAND_RUN_AGENT_TURA_MODEL,
  reasoning: process.env.COMMAND_RUN_AGENT_REASONING_EFFORT,
  startedAt,
  jobs: jobs.map(publicJob),
});

writeProgress();
console.log(`[design-matrix] root=${matrixRoot}`);
console.log(`[design-matrix] jobs=${jobs.length} concurrency=${concurrency}`);
const monitor = setInterval(() => {
  refreshProgress();
  writeProgress();
  console.log(`[monitor ${new Date().toISOString()}] ${progressLine()}`);
}, monitorMs);

await runQueue();
clearInterval(monitor);
refreshProgress();
writeProgress();
const summary = {
  schema: "tura.benchmark.design-matrix-summary.v1",
  ok: jobs.every((job) => job.exitCode === 0),
  startedAt,
  finishedAt: new Date().toISOString(),
  matrixRoot,
  progressPath,
  jobs: jobs.map(publicJob),
};
writeJson(summaryPath, summary);
console.log(
  `[design-matrix] finished ok=${summary.ok}; summary=${summaryPath}`,
);
process.exitCode = summary.ok ? 0 : 1;

function buildJobs() {
  const result = [];
  let index = 0;
  for (const taskId of selectedTasks) {
    const replicates = replicateOverrides.get(taskId) || defaultReplicates;
    for (const agentId of agents) {
      for (let replicate = 1; replicate <= replicates; replicate += 1) {
        index += 1;
        const suffix = `-matrix-${agentShort(agentId)}-r${String(replicate).padStart(2, "0")}`;
        const runRoot = path.join(
          benchmarkRawRoot(),
          "design",
          taskId,
          stamp,
          `${agentId}${suffix}`,
        );
        result.push({
          index,
          id: `${taskId}:${agentId}:${replicate}`,
          taskId,
          agentId,
          replicate,
          suffix,
          runRoot,
          status: "queued",
          pid: null,
          startedAt: null,
          finishedAt: null,
          exitCode: null,
          signal: null,
          spawnError: null,
          progress: null,
          child: null,
        });
      }
    }
  }
  return result;
}

async function runQueue() {
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      await runJob(job);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
}

function runJob(job) {
  return new Promise((resolve) => {
    assert(
      !fs.existsSync(job.runRoot),
      `refusing to overwrite existing run: ${job.runRoot}`,
    );
    const stdoutPath = path.join(logRoot, `${safeName(job.id)}.stdout.log`);
    const stderrPath = path.join(logRoot, `${safeName(job.id)}.stderr.log`);
    const stdoutFd = fs.openSync(stdoutPath, "a");
    const stderrFd = fs.openSync(stderrPath, "a");
    const env = {
      ...process.env,
      COMMAND_RUN_DESIGN_TASK: job.taskId,
      COMMAND_RUN_DESIGN_STAMP: stamp,
      COMMAND_RUN_DESIGN_RUN_SUFFIX: job.suffix,
      COMMAND_RUN_AGENT_AGENTS: job.agentId,
    };
    const child = spawn(
      process.execPath,
      [path.join(scriptDir, "run_design_task.mjs")],
      {
        cwd: repoRoot,
        env,
        stdio: ["ignore", stdoutFd, stderrFd],
        windowsHide: true,
      },
    );
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    job.child = child;
    job.pid = child.pid;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.stdoutPath = stdoutPath;
    job.stderrPath = stderrPath;
    writeProgress();
    child.on("error", (error) => {
      job.spawnError = String(error?.stack || error);
    });
    child.on("exit", (code, signal) => {
      job.exitCode = code;
      job.signal = signal;
      job.status = code === 0 ? "finished" : "failed";
      job.finishedAt = new Date().toISOString();
      job.child = null;
      refreshJobProgress(job);
      writeProgress();
      resolve();
    });
  });
}

function refreshProgress() {
  for (const job of jobs) refreshJobProgress(job);
}

function refreshJobProgress(job) {
  const status = readJson(path.join(job.runRoot, "metadata", "status.json"));
  const agentSummary = readJson(path.join(job.runRoot, "agent-summary.json"));
  job.progress = {
    state: job.status,
    elapsedMs: agentSummary?.elapsed_ms ?? status?.elapsed_ms ?? null,
    totalTokens: agentSummary?.usage?.total_tokens ?? null,
    rounds: agentSummary?.rounds ?? null,
    processStatus: status?.status ?? null,
    htmlReady: fs.existsSync(path.join(job.runRoot, "workspace", "index.html")),
    summaryReady: Boolean(agentSummary),
    stdoutBytes: fileSize(path.join(job.runRoot, "metadata", "stdout.jsonl")),
    stderrBytes: fileSize(path.join(job.runRoot, "metadata", "stderr.log")),
  };
}

function writeProgress() {
  refreshProgress();
  const counts = statusCounts();
  const lines = [
    "# Design Matrix Progress",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Matrix: ${stamp}`,
    `- Model: ${process.env.COMMAND_RUN_AGENT_CODEX_MODEL || ""} / ${process.env.COMMAND_RUN_AGENT_TURA_MODEL || ""}`,
    `- Reasoning: ${process.env.COMMAND_RUN_AGENT_REASONING_EFFORT || ""}`,
    `- Concurrency: ${concurrency}`,
    `- Progress: ${counts.finished + counts.failed}/${jobs.length} settled (${counts.running} running, ${counts.queued} queued, ${counts.failed} failed)`,
    "",
    "| # | Task | Agent | Run | State | Elapsed | Tokens | HTML | Summary |",
    "|---:|---|---|---:|---|---:|---:|:---:|:---:|",
  ];
  for (const job of jobs) {
    const p = job.progress || {};
    lines.push(
      `| ${job.index} | ${job.taskId} | ${job.agentId} | ${job.replicate} | ${job.status} | ${formatDuration(p.elapsedMs)} | ${p.totalTokens ?? "—"} | ${p.htmlReady ? "yes" : "no"} | ${p.summaryReady ? "yes" : "no"} |`,
    );
  }
  fs.writeFileSync(progressPath, `${lines.join("\n")}\n`, "utf8");
}

function progressLine() {
  const counts = statusCounts();
  return `${counts.finished + counts.failed}/${jobs.length} settled; running=${counts.running} queued=${counts.queued} failed=${counts.failed}`;
}

function statusCounts() {
  const counts = { queued: 0, running: 0, finished: 0, failed: 0 };
  for (const job of jobs) counts[job.status] += 1;
  return counts;
}

function selectTasks(value) {
  const discovered = fs
    .readdirSync(taskRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(taskRoot, entry.name, "task.json")),
    )
    .map((entry) => entry.name)
    .sort();
  const requested = parseList(value);
  if (
    requested.length === 0 ||
    requested.includes("all") ||
    requested.includes("*")
  )
    return discovered;
  for (const task of requested)
    assert(discovered.includes(task), `unknown design task: ${task}`);
  return requested;
}

function parseReplicateOverrides(value) {
  const result = new Map();
  for (const item of String(value || "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = item.lastIndexOf("=");
    assert(separator > 0, `invalid replicate override: ${item}`);
    const taskId = item.slice(0, separator).trim();
    assert(
      selectedTasks.includes(taskId),
      `replicate override references unselected task: ${taskId}`,
    );
    result.set(
      taskId,
      positiveInteger(item.slice(separator + 1), `replicates for ${taskId}`),
    );
  }
  return result;
}

function positiveInteger(value, label) {
  const number = Number(value);
  assert(
    Number.isInteger(number) && number > 0,
    `${label} must be a positive integer`,
  );
  return number;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function agentShort(agentId) {
  return agentId === "direct"
    ? "td"
    : agentId === "codex-cli"
      ? "cx"
      : safeName(agentId);
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-");
}

function publicJob(job) {
  const { child, ...result } = job;
  return result;
}

function formatDuration(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) / 1000)}s`;
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
