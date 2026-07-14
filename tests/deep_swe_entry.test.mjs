import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDeepSwePlan } from "../lib/deep_swe_entry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("DeepSWE entry derives portable paths and forces Tura bash", () => {
  const plan = buildDeepSwePlan({
    TURA_BENCHMARK_CONFIG: path.join(root, "config", "benchmark.json"),
    TURA_BENCHMARK_RAW_ROOT: path.join(root, "raw", "entry-test"),
    COMMAND_RUN_AGENT_RUN_ID: "portable-run",
    COMMAND_RUN_AGENT_AGENTS: "balanced",
    COMMAND_RUN_AGENT_REASONING_EFFORT: "high",
  });
  assert.equal(plan.turaShell, "bash");
  assert.deepEqual(plan.variants, [
    { agent: "balanced", replicate: 1, reasoning: "high" },
  ]);
  assert.equal(
    plan.runRoot,
    path.join(
      root,
      "raw",
      "entry-test",
      "deep-swe",
      "portable-run",
      "balanced",
    ),
  );
  assert.match(plan.tasksRoot, /raw[\\/]entry-test[\\/]_cache[\\/]deep-swe$/);
  assert.equal(plan.configuredTasksDirectory, ".");
  assert.equal(plan.revision, "a40d7298b18999c2d9b0ded7d6928e3ee26b5524");
});

test("DeepSWE task runner plan does not download or launch the matrix", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "tasks", "debug", "deep-swe-v1.1", "runner.mjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        TURA_BENCHMARK_DRY_RUN: "1",
        COMMAND_RUN_AGENT_AGENTS: "direct",
        COMMAND_RUN_AGENT_RUN_ID: "dry-run",
      },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.task, "deep-swe-v1.1");
  assert.equal(plan.tura_shell, "bash");
  assert.equal(plan.variants[0].agent, "direct");
});

test("debug matrix defaults to a cost-free public CLI plan", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts", "run_debug_matrix.mjs"),
      "--agents",
      "codex-cli",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.task, "deep-swe-v1.1");
  assert.equal(plan.expected_task_count, 20);
  assert.equal(plan.task_batch_size, 5);
  assert.equal(plan.concurrency, 15);
  assert.equal(plan.planned_runs, 60);
  assert.equal(plan.monitor_interval_ms, 60_000);
  assert.deepEqual(plan.variants, [
    { agent: "codex-cli", replicate: 1, reasoning: "high" },
    { agent: "codex-cli", replicate: 2, reasoning: "high" },
    { agent: "codex-cli", replicate: 3, reasoning: "high" },
  ]);
});

test("package scripts keep planning and paid execution visibly separate", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.doesNotMatch(packageJson.scripts["benchmark:deep-swe"], /--run/);
  assert.match(packageJson.scripts["benchmark:deep-swe:run"], /--run/);
  assert.match(packageJson.scripts["benchmark:deep-swe"], /--agents codex-cli/);
});

test("DeepSWE runner uses an exact 5-task x 3-replicate batch barrier", () => {
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  assert.match(runner, /taskBatchSize \* variants\.length/);
  assert.match(
    runner,
    /import \{ spawn, spawnSync \} from "node:child_process"/,
  );
  assert.match(runner, /await runAgentBatches\(\)/);
  assert.match(runner, /await runQueue\(pending, concurrency, runAgentJob\)/);
  assert.match(
    runner,
    /batchJobs\.length,[\s\S]*manifest\.runs_per_task_batch/,
  );
});

test("DeepSWE Tura launch is guarded by the bash argument preflight", () => {
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  const agentCli = fs.readFileSync(
    path.join(root, "lib", "generic_agent_cli.mjs"),
    "utf8",
  );
  assert.match(runner, /COMMAND_RUN_AGENT_TURA_SHELL = "bash"/);
  assert.match(runner, /args\.slice\(0, 3\).*"exec bash --json"/s);
  assert.match(agentCli, /shellSurface === "bash".*\[shellSurface\]/s);
});
