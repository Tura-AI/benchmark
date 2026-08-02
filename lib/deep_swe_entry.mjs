import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { projectPython } from "./python_runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEEP_SWE_TURA_SHELL = "bash";

export function buildDeepSwePlan(env = process.env) {
  const configPath = path.resolve(
    root,
    env.TURA_BENCHMARK_CONFIG || "config/benchmark.json",
  );
  const config = readJson(configPath);
  const deepSwe = config.deepSwe || {};
  const rawRoot = path.resolve(
    root,
    env.TURA_BENCHMARK_RAW_ROOT || config.rawRoot || "raw",
  );
  const runId = env.COMMAND_RUN_AGENT_RUN_ID || "deep-swe-v1.1";
  const checkoutRoot = path.resolve(
    root,
    env.DEEP_SWE_CHECKOUT_ROOT ||
      deepSwe.checkoutRoot ||
      path.join(rawRoot, "_cache", "deep-swe"),
  );
  const configuredTasksDirectory = deepSwe.tasksDirectory || ".";
  const tasksRoot = path.resolve(
    env.DEEP_SWE_TASKS_ROOT ||
      path.join(checkoutRoot, configuredTasksDirectory),
  );
  const agents = list(env.COMMAND_RUN_AGENT_AGENTS || "balanced");
  assert(agents.length > 0, "DeepSWE runner requires at least one agent");
  assert.equal(
    new Set(agents).size,
    agents.length,
    "DeepSWE runner agents must be unique",
  );
  const runSegment =
    env.DEEP_SWE_RUN_SEGMENT ||
    (agents.length === 1 ? agents[0] : agents.join("-"));
  const runRoot = path.resolve(
    env.TURA_BENCHMARK_RUN_DIRECTORY ||
      path.join(
        rawRoot,
        "deep-swe",
        safeSegment(runId),
        safeSegment(runSegment),
      ),
  );
  const selectionPath = path.resolve(
    env.DEEP_SWE_SELECTION || path.join(runRoot, "selection.json"),
  );
  const variants = agents.flatMap((agent) => {
    const configured = (deepSwe.variants || []).filter(
      (variant) => variant.agent === agent,
    );
    return (
      configured.length
        ? configured
        : [{ agent, replicate: 1, reasoning: "medium" }]
    ).map((variant) => ({
      ...variant,
      reasoning:
        env.COMMAND_RUN_AGENT_REASONING_EFFORT || variant.reasoning || "medium",
    }));
  });
  return {
    configPath,
    checkoutRoot,
    configuredTasksDirectory,
    managedCheckout: !env.DEEP_SWE_TASKS_ROOT,
    tasksRoot,
    selectionPath,
    runRoot,
    repository:
      deepSwe.repository || "https://github.com/datacurve-ai/deep-swe.git",
    revision: deepSwe.revision || "a40d7298b18999c2d9b0ded7d6928e3ee26b5524",
    agent: agents.length === 1 ? agents[0] : null,
    agents,
    variants,
    expectedTaskCount: Number(
      env.DEEP_SWE_EXPECTED_TASK_COUNT || deepSwe.expectedTaskCount || 0,
    ),
    taskBatchSize: Number(
      env.DEEP_SWE_TASK_BATCH_SIZE || deepSwe.taskBatchSize || 1,
    ),
    concurrency: Number(env.DEEP_SWE_CONCURRENCY || deepSwe.concurrency || 1),
    monitorMs: Number(env.DEEP_SWE_MONITOR_MS || deepSwe.monitorMs || 120_000),
    turaShell: DEEP_SWE_TURA_SHELL,
  };
}

export async function runDeepSweEntry(env = process.env) {
  const plan = buildDeepSwePlan(env);
  if (env.TURA_BENCHMARK_DRY_RUN === "1" || env.DEEP_SWE_PLAN === "1") {
    console.log(JSON.stringify(publicPlan(plan), null, 2));
    return;
  }

  ensureCheckout(plan);
  fs.mkdirSync(plan.runRoot, { recursive: true });
  if (!fs.existsSync(plan.selectionPath)) {
    runChecked(
      projectPython(root, env),
      [
        path.join(root, "deep_swe", "select_tasks.py"),
        "--tasks-root",
        plan.tasksRoot,
        "--output",
        plan.selectionPath,
      ],
      "create DeepSWE selection",
    );
  }
  if (env.DEEP_SWE_PREPARE_ONLY === "1") {
    console.log(
      JSON.stringify({ ...publicPlan(plan), prepared: true }, null, 2),
    );
    return;
  }

  const childEnv = {
    ...env,
    DEEP_SWE_RUN_ROOT: plan.runRoot,
    DEEP_SWE_TASKS_ROOT: plan.tasksRoot,
    DEEP_SWE_SELECTION: plan.selectionPath,
    DEEP_SWE_VARIANTS: JSON.stringify(plan.variants),
    COMMAND_RUN_AGENT_TURA_SHELL: DEEP_SWE_TURA_SHELL,
  };
  const result = spawnSync(
    process.execPath,
    [path.join(root, "deep_swe", "run_matrix.mjs")],
    { cwd: root, env: childEnv, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function ensureCheckout(plan) {
  const marker = path.join(
    plan.tasksRoot,
    "actionlint-action-pinning-lint",
    "task.toml",
  );
  if (!plan.managedCheckout) {
    if (fs.existsSync(marker)) return;
    assert(
      false,
      `DeepSWE tasks are missing from DEEP_SWE_TASKS_ROOT: ${marker}`,
    );
  }
  fs.mkdirSync(path.dirname(plan.checkoutRoot), { recursive: true });
  if (!fs.existsSync(path.join(plan.checkoutRoot, ".git"))) {
    runChecked(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        plan.repository,
        plan.checkoutRoot,
      ],
      "clone the DeepSWE task corpus",
    );
  }
  const currentRevision = runCaptured(
    "git",
    ["-C", plan.checkoutRoot, "rev-parse", "HEAD"],
    "read the cached DeepSWE revision",
  );
  if (fs.existsSync(marker) && currentRevision === plan.revision) return;
  if (plan.configuredTasksDirectory === ".") {
    runChecked(
      "git",
      ["-C", plan.checkoutRoot, "sparse-checkout", "disable"],
      "disable sparse checkout for the root-layout DeepSWE corpus",
    );
  } else {
    runChecked(
      "git",
      [
        "-C",
        plan.checkoutRoot,
        "sparse-checkout",
        "set",
        plan.configuredTasksDirectory,
      ],
      "configure the DeepSWE sparse checkout",
    );
  }
  runChecked(
    "git",
    ["-C", plan.checkoutRoot, "checkout", "--detach", plan.revision],
    "check out the pinned DeepSWE revision",
  );
  assert(
    fs.existsSync(marker),
    `DeepSWE tasks are missing after checkout: ${marker}`,
  );
}

function runChecked(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `failed to ${label}`);
}

function runCaptured(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `failed to ${label}: ${result.stderr || ""}`);
  return String(result.stdout || "").trim();
}

function publicPlan(plan) {
  return {
    task: "deep-swe-v1.1",
    repository: plan.repository,
    revision: plan.revision,
    checkout_root: plan.checkoutRoot,
    tasks_root: plan.tasksRoot,
    tasks_directory: plan.configuredTasksDirectory,
    selection: plan.selectionPath,
    run_root: plan.runRoot,
    agents: plan.agents,
    variants: plan.variants,
    expected_task_count: plan.expectedTaskCount,
    task_batch_size: plan.taskBatchSize,
    concurrency: plan.concurrency,
    planned_runs: plan.expectedTaskCount * plan.variants.length,
    monitor_interval_ms: plan.monitorMs,
    tura_shell: plan.turaShell,
  };
}

function safeSegment(value) {
  const result = String(value).replace(/[^A-Za-z0-9._-]+/g, "-");
  assert(result && result !== "." && result !== "..", "invalid DeepSWE run id");
  return result;
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
