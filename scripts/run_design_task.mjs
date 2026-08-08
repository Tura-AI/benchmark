#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ensureGenericAgentExecutables,
  genericAgentKind,
  genericAgentMode,
  parseGenericAgents,
  runGenericAgentCli,
} from "../lib/generic_agent_cli.mjs";
import { benchmarkRawRoot } from "../lib/business_paths.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const taskId = requiredEnv("COMMAND_RUN_DESIGN_TASK");
const taskDir = path.join(repoRoot, "tasks", "design", safeSegment(taskId));
const task = readJson(path.join(taskDir, "task.json"));
assert.equal(task.id, taskId, "task id does not match its directory");
assert.equal(
  task.category,
  "design",
  "design runner only accepts design tasks",
);
assert.equal(
  task.evaluation?.mode,
  "design",
  "design runner requires evaluation.mode=design",
);
assert(
  !Object.hasOwn(task, "harness"),
  "design tasks must not define a harness",
);
const prompt = fs
  .readFileSync(path.join(taskDir, task.promptLocation), "utf8")
  .trim();
assert(prompt, "task prompt is empty");

const agents = parseGenericAgents(process.env.COMMAND_RUN_AGENT_AGENTS);
const model =
  process.env.TURA_BENCHMARK_MODEL ||
  process.env.COMMAND_RUN_AGENT_CODEX_MODEL ||
  "gpt-5.6-sol";
const turaModel = process.env.COMMAND_RUN_AGENT_TURA_MODEL || `openai/${model}`;
const reasoning = process.env.COMMAND_RUN_AGENT_REASONING_EFFORT || "high";
const serviceTier = process.env.COMMAND_RUN_AGENT_SERVICE_TIER || "default";
const modelConfiguration = process.env.TURA_BENCHMARK_MODEL_CONFIGURATION
  ? JSON.parse(process.env.TURA_BENCHMARK_MODEL_CONFIGURATION)
  : null;
const timeoutMs = Number(
  process.env.COMMAND_RUN_AGENT_TIMEOUT_MS || 2 * 60 * 60_000,
);
const stamp = process.env.COMMAND_RUN_DESIGN_STAMP || timestamp();
const runSuffix = optionalSuffix(process.env.COMMAND_RUN_DESIGN_RUN_SUFFIX);
const batchRoot = process.env.TURA_BENCHMARK_RUN_DIRECTORY
  ? path.resolve(process.env.TURA_BENCHMARK_RUN_DIRECTORY)
  : path.join(benchmarkRawRoot(), "design", safeSegment(taskId), stamp);
const manifestName = runSuffix
  ? `batch-manifest${runSuffix}.json`
  : "batch-manifest.json";
const summaryName = runSuffix ? `summary${runSuffix}.json` : "summary.json";
const progress = new Map();
const startedAt = new Date().toISOString();

fs.mkdirSync(batchRoot, { recursive: true });
ensureGenericAgentExecutables(agents, { repoRoot });
writeJson(path.join(batchRoot, manifestName), {
  schema: "tura.benchmark.design-batch.v1",
  taskId,
  agents,
  model,
  turaModel,
  reasoning,
  serviceTier,
  modelConfiguration,
  startedAt,
  batchRoot,
});

console.log(`[design] batch=${batchRoot}`);
console.log(
  `[design] starting ${agents.length} concurrent runs: ${agents.join(", ")}`,
);
const monitor = setInterval(printProgress, 60_000);
const results = await Promise.all(agents.map(runAgent));
clearInterval(monitor);
printProgress();

const summary = {
  schema: "tura.business-test.summary.v1",
  ok: results.every((result) => result.exit_code === 0),
  agents,
  results,
  task: taskId,
  model,
  tura_model: turaModel,
  reasoning,
  service_tier: serviceTier,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  batch_root: batchRoot,
};
writeJson(path.join(batchRoot, summaryName), summary);
console.log(
  `[design] finished ok=${summary.ok}; summary=${path.join(batchRoot, summaryName)}`,
);
process.exitCode = summary.ok ? 0 : 1;

async function runAgent(agentId) {
  const runRoot = process.env.TURA_BENCHMARK_RUN_DIRECTORY
    ? batchRoot
    : path.join(batchRoot, safeSegment(`${agentId}${runSuffix}`));
  const workspace = path.join(runRoot, "workspace");
  const agentDir = path.join(runRoot, "metadata");
  const turaHome = path.join(runRoot, "home", "tura");
  const turaDbRoot = path.join(runRoot, "home", "tura-db");
  const sessionLogDbRoot = path.join(runRoot, "home", "session-log-db");
  for (const directory of [
    workspace,
    agentDir,
    turaHome,
    turaDbRoot,
    sessionLogDbRoot,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(
    path.join(runRoot, "raw-first-round-prompt.txt"),
    `${prompt}\n`,
    "utf8",
  );
  writeJson(path.join(runRoot, "task.json"), task);
  const started = Date.now();
  progress.set(agentId, {
    state: "starting",
    elapsed_ms: 0,
    stdout_bytes: 0,
    stderr_bytes: 0,
  });
  try {
    const result = await runGenericAgentCli({
      agentId,
      workspace,
      agentDir,
      prompt,
      repoRoot,
      model,
      turaModel,
      reasoning,
      serviceTier,
      timeoutMs,
      turaHome,
      turaDbRoot,
      sessionLogDbRoot,
      onProgress(current) {
        progress.set(agentId, {
          state: "running",
          elapsed_ms: current.duration_ms,
          stdout_bytes: Buffer.byteLength(current.stdout || ""),
          stderr_bytes: Buffer.byteLength(current.stderr || ""),
        });
      },
    });
    const usage = result.usage_info?.usage || {};
    const summary = {
      agent: agentId,
      agent_id: agentId,
      agent_kind: genericAgentKind(agentId),
      agent_mode: genericAgentMode(agentId),
      model: genericAgentKind(agentId) === "tura" ? turaModel : model,
      tura_model: genericAgentKind(agentId) === "tura" ? turaModel : undefined,
      reasoning,
      service_tier: serviceTier,
      priority_enabled: serviceTier === "priority",
      task: task.title,
      task_id: taskId,
      workspace,
      elapsed_ms: result.duration_ms,
      exit_code: result.status,
      signal: result.signal,
      timed_out: result.timed_out,
      first_output_ms: result.first_output_ms,
      last_progress_ms: result.last_progress_ms,
      error: result.error || null,
      stdout_path: path.join(agentDir, "stdout.jsonl"),
      stderr_path: path.join(agentDir, "stderr.log"),
      provider_log_path: path.join(agentDir, "provider-log"),
      usage,
      usage_source: result.usage_info?.usage_source || null,
      provider_calls: result.usage_info?.provider_calls || [],
      rounds: result.rounds?.length || 0,
      rounds_directory: result.rounds_directory,
      rounds_jsonl_path: result.rounds_jsonl_path,
      round_contract_validation: result.round_contract_validation,
      model_configuration: result.model_configuration,
      events: result.events || {},
      patch: artifactSummary(workspace),
      home:
        genericAgentKind(agentId) === "tura"
          ? turaHome
          : path.join(agentDir, "codex-home"),
    };
    writeJson(path.join(runRoot, "agent-summary.json"), summary);
    progress.set(agentId, {
      state: "finished",
      elapsed_ms: result.duration_ms,
      exit_code: result.status,
      total_tokens: usage.total_tokens ?? null,
    });
    return summary;
  } catch (error) {
    const summary = {
      agent: agentId,
      agent_id: agentId,
      agent_kind: genericAgentKind(agentId),
      agent_mode: genericAgentMode(agentId),
      model: genericAgentKind(agentId) === "tura" ? turaModel : model,
      reasoning,
      service_tier: serviceTier,
      task: task.title,
      task_id: taskId,
      workspace,
      elapsed_ms: Date.now() - started,
      exit_code: null,
      error: String(error?.stack || error),
      model_configuration: modelConfiguration,
      usage: {},
      events: {},
      patch: artifactSummary(workspace),
    };
    writeJson(path.join(runRoot, "agent-summary.json"), summary);
    progress.set(agentId, {
      state: "failed",
      elapsed_ms: summary.elapsed_ms,
      error: String(error?.message || error),
    });
    return summary;
  }
}

function printProgress() {
  const now = new Date().toISOString();
  const text = agents
    .map((agent) => {
      const item = progress.get(agent) || { state: "pending" };
      const seconds =
        item.elapsed_ms == null ? "-" : Math.round(item.elapsed_ms / 1000);
      const tokens = item.total_tokens ?? "-";
      return `${agent}:${item.state}:${seconds}s:tokens=${tokens}:out=${item.stdout_bytes ?? "-"}`;
    })
    .join(" | ");
  console.log(`[monitor ${now}] ${text}`);
}

function artifactSummary(workspace) {
  const files = walk(workspace);
  return {
    bytes: files.reduce((total, file) => total + fs.statSync(file).size, 0),
    changed_files: files.length,
    files: files.map((file) =>
      path.relative(workspace, file).replaceAll("\\", "/"),
    ),
  };
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort();
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  assert(value, `${name} is required`);
  return value;
}

function safeSegment(value) {
  const text = String(value || "").trim();
  assert(/^[A-Za-z0-9._-]+$/.test(text), `invalid path segment: ${text}`);
  return text;
}

function optionalSuffix(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  assert(/^-[A-Za-z0-9._-]+$/.test(text), `invalid run suffix: ${text}`);
  return text;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
