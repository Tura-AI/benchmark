#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const reasoning = args.reasoning || "high";
const runId =
  args.runId ||
  process.env.COMMAND_RUN_AGENT_RUN_ID ||
  `deep-swe-v1.1-tura-balanced-direct-${reasoning}-${timestamp()}`;

assert.equal(
  reasoning,
  "high",
  "the Tura paired matrix is pinned to high reasoning",
);

const env = {
  ...process.env,
  COMMAND_RUN_AGENT_AGENTS: "balanced,direct",
  COMMAND_RUN_AGENT_REASONING_EFFORT: reasoning,
  COMMAND_RUN_AGENT_RUN_ID: runId,
  DEEP_SWE_RUN_SEGMENT: "tura-balanced-direct",
  DEEP_SWE_SHARED_TASK_CONTAINERS: "1",
  DEEP_SWE_CONCURRENCY: "5",
  DEEP_SWE_TASK_BATCH_SIZE: "5",
  ...(args.run ? {} : { TURA_BENCHMARK_DRY_RUN: "1" }),
};
const runner = path.join(root, "tasks", "debug", "deep-swe-v1.1", "runner.mjs");
const result = spawnSync(process.execPath, [runner], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

function parseArgs(argv) {
  const result = { run: false, reasoning: null, runId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") result.run = true;
    else if (arg === "--plan") result.run = false;
    else if (arg === "--reasoning") result.reasoning = argv[++index];
    else if (arg.startsWith("--reasoning="))
      result.reasoning = arg.slice("--reasoning=".length);
    else if (arg === "--run-id") result.runId = argv[++index];
    else if (arg.startsWith("--run-id="))
      result.runId = arg.slice("--run-id=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
