#!/usr/bin/env node
import process from "node:process";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv.slice(2);
const run = takeFlag(input, "--run");
const planOnly = takeFlag(input, "--plan");
const forwarded = normalizeTasks(input);
const command = run && !planOnly ? "run" : "plan";
const args = [
  path.join(root, "scripts", "benchmark.mjs"),
  command,
  "--task",
  "deep-swe-v1.1",
  ...forwarded,
];

const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

function takeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function normalizeTasks(args) {
  const result = [...args];
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] === "--tasks") result[index] = "--task";
    else if (result[index].startsWith("--tasks="))
      result[index] = `--task=${result[index].slice("--tasks=".length)}`;
  }
  const taskIndex = result.findIndex(
    (item) => item === "--task" || item.startsWith("--task="),
  );
  if (taskIndex >= 0) {
    const inline = result[taskIndex].startsWith("--task=");
    const value = inline
      ? result[taskIndex].slice("--task=".length)
      : result[taskIndex + 1];
    if (value !== "deep-swe-v1.1")
      throw new Error(
        "run_debug_matrix.mjs currently supports deep-swe-v1.1 only",
      );
    result.splice(taskIndex, inline ? 1 : 2);
  }
  return result;
}
