#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { projectPython } from "../lib/python_runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const configPath = resolvePath(
  args.config || process.env.TURA_BENCHMARK_CONFIG || "config/benchmark.json",
);
const config = readJson(configPath);
assert.equal(
  config.schema,
  "tura.benchmark.runtime-config.v1",
  `invalid runtime config: ${configPath}`,
);
const agentConfigPath = resolvePath(
  args["agent-config"] ||
    process.env.TURA_BENCHMARK_AGENT_CONFIG ||
    config.agentConfig,
);
const agentConfig = readJson(agentConfigPath);
const tasks = discoverTasks();

if (command === "help" || args.help) printHelp();
else if (command === "list")
  print({
    tasks: tasks.map(publicTask),
    agents: agentConfig.agents.map(publicAgent),
  });
else if (command === "plan" || command === "run") await execute(command);
else if (command === "validate") validate();
else throw new Error(`unknown command: ${command}`);

async function execute(mode) {
  const selected = selectTasks(args.task || process.env.TURA_BENCHMARK_TASKS);
  const agentIds = parseList(
    args.agents || process.env.TURA_BENCHMARK_AGENTS || config.defaults.agents,
  );
  const agents = agentIds.length
    ? agentIds.map(resolveAgent)
    : agentConfig.defaultAgents.map(resolveAgent);
  const replicates = positiveInteger(
    args.replicates ||
      process.env.TURA_BENCHMARK_REPLICATES ||
      config.defaults.replicates,
    "replicates",
  );
  const concurrency = positiveInteger(
    args.concurrency ||
      process.env.TURA_BENCHMARK_CONCURRENCY ||
      config.defaults.concurrency,
    "concurrency",
  );
  const jobs = selected.flatMap((task) =>
    agents.flatMap((agent) =>
      Array.from({ length: replicates }, (_, index) =>
        buildJob(task, agent, index + 1),
      ),
    ),
  );
  if (mode === "plan" || args["dry-run"])
    return print({
      config: configPath,
      agentConfig: agentConfigPath,
      concurrency,
      jobs,
    });
  await runJobs(jobs, concurrency);
}

async function runJobs(jobs, concurrency) {
  let next = 0;
  let failure = null;
  async function worker() {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      try {
        await runJob(job);
      } catch (error) {
        failure = error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
  if (failure) throw failure;
}

function runJob(job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [job.runner], {
      cwd: root,
      env: { ...process.env, ...job.env },
      stdio: "inherit",
      timeout: Number(job.env.COMMAND_RUN_AGENT_TIMEOUT_MS),
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${job.task}/${job.agent} exited with ${code ?? signal ?? "unknown status"}`,
          ),
        );
    });
  });
}

function buildJob(task, agent, replicate) {
  const variant = selectVariant(task);
  const runId =
    args["run-id"] ||
    process.env.TURA_BENCHMARK_RUN_ID ||
    `${task.id}-${agent.id}-r${String(replicate).padStart(2, "0")}`;
  const model =
    args.model || process.env.TURA_BENCHMARK_MODEL || agent.defaultModel || "";
  const reasoning =
    args.reasoning ||
    process.env.TURA_BENCHMARK_REASONING ||
    config.defaults.reasoning;
  const rawRoot = resolvePath(
    args["raw-root"] || process.env.TURA_BENCHMARK_RAW_ROOT || config.rawRoot,
  );
  const env = {
    ...variant.env,
    ...parseEnv(args.env),
    TURA_BENCHMARK_CONFIG: configPath,
    TURA_BENCHMARK_AGENT_CONFIG: agentConfigPath,
    TURA_BENCHMARK_RAW_ROOT: rawRoot,
    TURA_BENCHMARK_RESULTS_ROOT: resolvePath(
      args["results-root"] ||
        process.env.TURA_BENCHMARK_RESULTS_ROOT ||
        config.resultsRoot,
    ),
    COMMAND_RUN_AGENT_AGENTS: agent.id,
    COMMAND_RUN_AGENT_RUN_ID: runId,
    COMMAND_RUN_AGENT_REASONING_EFFORT: String(reasoning),
    COMMAND_RUN_AGENT_SERVICE_TIER: String(
      args["service-tier"] ||
        process.env.TURA_BENCHMARK_SERVICE_TIER ||
        config.defaults.serviceTier,
    ),
    COMMAND_RUN_AGENT_TIMEOUT_MS: String(
      args["timeout-ms"] ||
        process.env.TURA_BENCHMARK_TIMEOUT_MS ||
        config.defaults.timeoutMs,
    ),
  };
  if (model) {
    env.TURA_BENCHMARK_MODEL = model;
    if (agent.modelEnv) env[agent.modelEnv] = model;
  }
  if (task.kind === "design") env.COMMAND_RUN_DESIGN_TASK = task.id;
  return {
    task: task.id,
    variant: variant.id,
    agent: agent.id,
    replicate,
    runId,
    runner: variant.runner,
    env,
  };
}

function discoverTasks() {
  const found = [];
  const taskRoot = path.join(root, "tasks");
  for (const category of fs
    .readdirSync(taskRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())) {
    for (const entry of fs
      .readdirSync(path.join(taskRoot, category.name), { withFileTypes: true })
      .filter((item) => item.isDirectory())) {
      const directory = path.join(taskRoot, category.name, entry.name);
      const declarationPath = path.join(directory, "benchmark.task.json");
      const taskPath = path.join(directory, "task.json");
      if (fs.existsSync(declarationPath)) {
        const declaration = readJson(declarationPath);
        found.push({ ...declaration, kind: "executable", directory });
      } else if (category.name === "design" && fs.existsSync(taskPath)) {
        const task = readJson(taskPath);
        found.push({
          ...task,
          type: "design",
          kind: "design",
          directory,
          variants: [
            {
              id: "default",
              default: true,
              runner: path.join(root, "scripts", "run_design_task.mjs"),
            },
          ],
        });
      }
    }
  }
  return found.sort((left, right) => left.id.localeCompare(right.id));
}

function selectTasks(value) {
  const requested = parseList(value);
  assert(
    requested.length > 0,
    "--task is required; use --task all to run every task",
  );
  if (requested.includes("all") || requested.includes("*")) return tasks;
  return requested.map((id) => {
    const task = tasks.find((candidate) => candidate.id === id);
    assert(task, `unknown task: ${id}`);
    return task;
  });
}

function selectVariant(task) {
  const id = args.variant || process.env.TURA_BENCHMARK_VARIANT;
  const variant = id
    ? task.variants.find((candidate) => candidate.id === id)
    : task.variants.find((candidate) => candidate.default) || task.variants[0];
  assert(variant, `unknown variant for ${task.id}: ${id}`);
  return { ...variant, runner: path.resolve(task.directory, variant.runner) };
}

function resolveAgent(id) {
  const normalized = String(id).trim().toLowerCase();
  const runtime = agentConfig.runtimeAliases?.find(
    (candidate) =>
      candidate.id === normalized || candidate.aliases?.includes(normalized),
  );
  const profileId = runtime?.profile || normalized;
  const profile = agentConfig.agents.find(
    (candidate) =>
      candidate.id === profileId || candidate.aliases?.includes(profileId),
  );
  assert(profile, `unknown agent: ${id}`);
  return {
    ...profile,
    id: runtime?.id || profile.id,
    profileId: profile.id,
    kind: runtime?.kind,
    mode: runtime?.mode,
  };
}

function validate() {
  const result = spawnSync(
    projectPython(root),
    [path.join(root, "schema", "validate.py"), "--benchmark-data", root],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  process.exitCode = result.status ?? 1;
}

function publicTask(task) {
  return {
    id: task.id,
    type: task.type || task.category,
    title: task.title,
    variants: task.variants.map((variant) => variant.id),
  };
}

function publicAgent(agent) {
  const runtimes = (agentConfig.runtimeAliases || []).filter(
    (runtime) => runtime.profile === agent.id,
  );
  return {
    id: agent.id,
    aliases: agent.aliases || [],
    runtimeIds: runtimes.map((runtime) => runtime.id),
    commandEnv: agent.commandEnv,
    modelEnv: agent.modelEnv || null,
  };
}

function parseArgs(argv) {
  const result = { _: [], env: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) result._.push(item);
    else {
      const [rawKey, inline] = item.slice(2).split("=", 2);
      const value =
        inline ??
        (argv[index + 1] && !argv[index + 1].startsWith("--")
          ? argv[++index]
          : true);
      if (rawKey === "env") result.env.push(value);
      else result[rawKey] = value;
    }
  }
  return result;
}

function parseEnv(values) {
  return Object.fromEntries(
    (Array.isArray(values) ? values : [values]).filter(Boolean).map((item) => {
      const index = String(item).indexOf("=");
      assert(index > 0, `--env must be KEY=VALUE: ${item}`);
      return [String(item).slice(0, index), String(item).slice(index + 1)];
    }),
  );
}

function parseList(value) {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, label) {
  const number = Number(value);
  assert(
    Number.isInteger(number) && number > 0,
    `${label} must be a positive integer`,
  );
  return number;
}

function resolvePath(value) {
  return path.resolve(root, String(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage: tura-benchmark <command> [options]

Commands:
  list       List discovered tasks and configured agents
  plan       Print the resolved execution plan without running agents
  run        Execute the resolved plan
  validate   Validate schemas and all published results

Options:
  --config FILE          Runtime configuration (TURA_BENCHMARK_CONFIG)
  --agent-config FILE    Agent profiles (TURA_BENCHMARK_AGENT_CONFIG)
  --task IDS             Comma-separated task IDs or all
  --agents IDS           Comma-separated profile IDs, runtime IDs, or aliases
  --model MODEL          Model override
  --reasoning LEVEL      Reasoning effort
  --replicates N         Runs per task and agent
  --concurrency N        Maximum simultaneous runs (TURA_BENCHMARK_CONCURRENCY)
  --variant ID           Task runner variant
  --timeout-ms N         Per-run timeout
  --raw-root DIR         Local run artifact root
  --results-root DIR     Published result root
  --env KEY=VALUE        Additional runner environment; repeatable
  --dry-run              Resolve a run without executing it`);
}
