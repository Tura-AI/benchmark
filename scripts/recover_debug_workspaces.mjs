#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { recoverDebugWorkspaces } from "../lib/debug_workspace_recovery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const result = recoverDebugWorkspaces({
  rawRoot: path.resolve(root, args["raw-root"] || "raw"),
  resultsRoot: path.resolve(root, args["results-root"] || "results/debug"),
  cacheRoot: args["cache-root"]
    ? path.resolve(root, args["cache-root"])
    : undefined,
  agents: args["all-agents"] ? ["*"] : list(args.agents || "codex-cli"),
  reports: list(args.report),
  tasks: list(args.task),
  overwrite: Boolean(args.overwrite),
  offline: Boolean(args.offline),
  dryRun: Boolean(args["dry-run"]),
  check: Boolean(args.check),
});
console.log(JSON.stringify(result, null, 2));
if (args.check && !result.ok) process.exitCode = 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument: ${item}`);
    const [key, inline] = item.slice(2).split("=", 2);
    result[key] =
      inline ??
      (argv[index + 1] && !argv[index + 1].startsWith("--")
        ? argv[++index]
        : true);
  }
  return result;
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`Usage: node scripts/recover_debug_workspaces.mjs [options]

Rebuild published debug workspace directories from raw DeepSWE patches.
The workspace is a verified changed-files snapshot, not a full repository.

Options:
  --raw-root DIR       Raw artifact root (default: raw)
  --results-root DIR   Published debug root (default: results/debug)
  --cache-root DIR     Partial Git mirror cache
  --agents IDS         Comma-separated agents (default: codex-cli)
  --all-agents         Recover every agent
  --report IDS         Comma-separated report directory names
  --task IDS           Comma-separated task IDs
  --overwrite          Replace an invalid or existing workspace
  --offline            Refuse network access; require cached Git objects
  --dry-run            Resolve raw/result mappings without writing
  --check              Verify every selected diff and workspace
  --help               Show this help`);
}
