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

test("DeepSWE plan supports a shared balanced/direct task matrix", () => {
  const plan = buildDeepSwePlan({
    TURA_BENCHMARK_CONFIG: path.join(root, "config", "benchmark.json"),
    COMMAND_RUN_AGENT_RUN_ID: "tura-pair",
    COMMAND_RUN_AGENT_AGENTS: "balanced,direct",
    COMMAND_RUN_AGENT_REASONING_EFFORT: "high",
    DEEP_SWE_RUN_SEGMENT: "tura-balanced-direct",
    DEEP_SWE_CONCURRENCY: "5",
    DEEP_SWE_TASK_BATCH_SIZE: "5",
  });
  assert.deepEqual(plan.agents, ["balanced", "direct"]);
  assert.deepEqual(plan.variants, [
    { agent: "balanced", replicate: 1, reasoning: "high" },
    { agent: "direct", replicate: 1, reasoning: "high" },
  ]);
  assert.equal(plan.concurrency, 5);
  assert.equal(plan.taskBatchSize, 5);
  assert.match(plan.runRoot, /tura-pair[\\/]tura-balanced-direct$/);
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

test("Tura paired debug runner plans 20 tasks x 2 agents on five shared containers", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "run_debug_tura_pair.mjs")],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.agents, ["balanced", "direct"]);
  assert.equal(plan.expected_task_count, 20);
  assert.equal(plan.task_batch_size, 5);
  assert.equal(plan.concurrency, 5);
  assert.equal(plan.planned_runs, 40);
  assert.deepEqual(plan.variants, [
    { agent: "balanced", replicate: 1, reasoning: "high" },
    { agent: "direct", replicate: 1, reasoning: "high" },
  ]);
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  assert.match(runner, /async function runSharedTuraTaskContainer/);
  assert.match(runner, /\/tura-workspaces\/\$\{safeSegment\(job\.agent\)\}/);
  assert.match(runner, /shared_task_container: true/);
  assert.match(runner, /"--init"/);
  assert.match(runner, /await Promise\.all\([\s\S]*executePreparedAgentJob/);
  assert.match(
    runner,
    /shared-container concurrency must equal the task batch size/,
  );
});

test("package scripts keep planning and paid execution visibly separate", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.doesNotMatch(packageJson.scripts["benchmark:deep-swe"], /--run/);
  assert.match(packageJson.scripts["benchmark:deep-swe:run"], /--run/);
  assert.match(packageJson.scripts["benchmark:deep-swe"], /--agents codex-cli/);
  assert.doesNotMatch(
    packageJson.scripts["benchmark:deep-swe:tura-pair"],
    /--run/,
  );
  assert.match(
    packageJson.scripts["benchmark:deep-swe:tura-pair:run"],
    /--run/,
  );
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
  assert.match(runner, /This is an unattended benchmark run/);
  assert.match(
    runner,
    /Never terminate processes belonging to another \/tura-workspaces/,
  );
});

test("DeepSWE retries only explicit Docker or environment failures", () => {
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  assert.match(
    runner,
    /timed_out === true[\s\S]*retryable: false, classification: "agent-timeout"/,
  );
  assert.match(
    runner,
    /selected model is at capacity[\s\S]*retryable: true, classification: "model-service-environment"/,
  );
  assert.match(runner, /rate\.\?limit/);
  assert.match(runner, /service unavailable/);
  assert.match(runner, /classification: "docker-environment"/);
  assert.match(runner, /docker\\s\+exec\[\^\\r\\n\]\*failed with null/);
  assert.match(runner, /classification: "host-environment"/);
  assert.match(
    runner,
    /retryable: false, classification: "agent-terminal-failure"/,
  );
  assert.match(runner, /attempt_incomplete = !taskComplete/);
  assert.match(
    runner,
    /retained contract-valid partial Codex attempt after model-capacity exit without retry/,
  );
  assert.match(
    runner,
    /batchJobs\.filter\(\(job\) => job\.state === "pending"\)/,
  );
});

test("DeepSWE captures completed agent artifacts from the host bind mount", () => {
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  assert.match(runner, /\["-C", workspace, "status", "--short"\]/);
  assert.match(runner, /\["-C", workspace, "add", "-A"\]/);
  assert.match(
    runner,
    /\["-C", workspace, "diff", "--cached", "--binary", baselineTree\]/,
  );
  assert.doesNotMatch(
    runner,
    /\["exec", "-w", containerWorkdir, container, "git", "status"/,
  );
  assert.match(runner, /spawn error: \$\{result\.error\}/);
  assert.match(runner, /result\.timedOut[\s\S]*"timed out"/);
  assert.match(runner, /repairCompletedTuraArtifactCaptureFailures/);
  assert.match(runner, /artifact_capture_recovered: true/);
  assert.match(runner, /expectedLlmRounds[\s\S]*allLlmTurnsRecovered/);
});

test("DeepSWE runs five verifier images concurrently and generates their Dockerfiles", () => {
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  assert.match(runner, /chunk\(batches, HARNESS_IMAGE_CONCURRENCY\)/);
  assert.match(runner, /await Promise\.all\([\s\S]*runnable\.map/);
  assert.match(runner, /"FROM \$\{BASE_IMAGE\}"/);
  assert.match(runner, /"COPY test\.sh \/tests\/test\.sh"/);
  assert.match(runner, /`BASE_IMAGE=\$\{task\.docker_image\}`/);
  assert.match(
    runner,
    /fs\.mkdirSync\(verifierOutputDir, \{ recursive: true \}\)/,
  );
});

test("DeepSWE live monitor sums provider-call usage instead of session snapshots", () => {
  const runner = fs.readFileSync(
    path.join(root, "deep_swe", "run_matrix.mjs"),
    "utf8",
  );
  assert.match(runner, /const live = aggregateLiveJobUsage\(\)/);
  assert.match(
    runner,
    /record\?\.metrics\?\.usage \|\| record\?\.response\?\.usage/,
  );
  assert.match(runner, /providerUsage\.input_tokens_details\?\.cached_tokens/);
  assert.match(
    runner,
    /providerUsage\.output_tokens_details\?\.reasoning_tokens/,
  );
  assert.match(runner, /llm_turns: live\.llmTurns/);
});
