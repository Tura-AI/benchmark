#!/usr/bin/env node
import assert from "node:assert/strict";
import process from "node:process";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const agent = args.agent || "codex-cli";
const reasoning = args.reasoning || "high";
const runId =
  args.runId ||
  process.env.COMMAND_RUN_AGENT_RUN_ID ||
  `deep-swe-v1.1-${agent}-${reasoning}-${timestamp()}`;

assert.equal(
  agent,
  "codex-cli",
  "the configured DeepSWE 20x3 matrix is pinned to codex-cli",
);
assert.equal(
  reasoning,
  "high",
  "the configured DeepSWE 20x3 matrix is pinned to high reasoning",
);

const env = {
  ...process.env,
  COMMAND_RUN_AGENT_AGENTS: agent,
  COMMAND_RUN_AGENT_REASONING_EFFORT: reasoning,
  COMMAND_RUN_AGENT_RUN_ID: runId,
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
  const result = { run: false, agent: null, reasoning: null, runId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") result.run = true;
    else if (arg === "--plan") result.run = false;
    else if (arg === "--agents" || arg === "--agent")
      result.agent = single(argv[++index], arg);
    else if (arg.startsWith("--agents="))
      result.agent = single(arg.slice("--agents=".length), "--agents");
    else if (arg.startsWith("--agent="))
      result.agent = single(arg.slice("--agent=".length), "--agent");
    else if (arg === "--reasoning") result.reasoning = argv[++index];
    else if (arg.startsWith("--reasoning="))
      result.reasoning = arg.slice("--reasoning=".length);
    else if (arg === "--run-id") result.runId = argv[++index];
    else if (arg.startsWith("--run-id="))
      result.runId = arg.slice("--run-id=".length);
    else if (arg === "--task" || arg === "--tasks")
      assert.equal(argv[++index], "deep-swe-v1.1");
    else if (arg.startsWith("--task=") || arg.startsWith("--tasks="))
      assert.equal(arg.slice(arg.indexOf("=") + 1), "deep-swe-v1.1");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function single(value, flag) {
  const values = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  assert.equal(values.length, 1, `${flag} accepts exactly one agent`);
  return values[0];
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
