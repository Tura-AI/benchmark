#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { npmInvocation } from "../lib/npm_runtime.mjs";
import { projectPython } from "../lib/python_runtime.mjs";
import { findCodexCliExe } from "../lib/generic_agent_cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

if (argv.includes("--help")) {
  console.log(`Usage: node scripts/doctor.mjs [--benchmark] [--agents IDS]

Checks local test prerequisites. --benchmark also checks the Docker daemon and
the comma-separated agent runtime IDs needed for a live benchmark.`);
  process.exit(0);
}

const benchmark = takeFlag("--benchmark");
const agentValue = takeValue("--agents") || "balanced";
if (argv.length) fail(`unknown option: ${argv[0]}`);

const checks = [];
checkVersion("Node.js", process.execPath, ["--version"], 20);
const npm = npmInvocation();
checkVersion("npm", npm.command, [...npm.args, "--version"], 9);
checkVersion("Python", projectPython(root), ["--version"], 3, 11);
checkCommand("Python packages", projectPython(root), [
  "-c",
  "import jsonschema, referencing; print('jsonschema and referencing available')",
]);
checkVersion("Git", "git", ["--version"], 2);
checkFile("Node lockfile", path.join(root, "package-lock.json"));
checkFile("Python requirements", path.join(root, "requirements.txt"));
checkFile(
  "Node dependencies",
  path.join(root, "node_modules", ".package-lock.json"),
);

if (benchmark) {
  checkCommand("Docker CLI", "docker", ["--version"]);
  checkCommand("Docker daemon", "docker", [
    "info",
    "--format",
    "{{.ServerVersion}}",
  ]);
  const config = JSON.parse(
    fs.readFileSync(path.join(root, "config", "agents.json"), "utf8"),
  );
  for (const id of split(agentValue)) checkAgent(config, id);
}

for (const item of checks) {
  const detail = item.detail ? ` - ${item.detail}` : "";
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.label}${detail}`);
}
const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`Doctor found ${failed.length} blocking issue(s).`);
  process.exitCode = 1;
} else {
  console.log(
    benchmark
      ? "Ready for a benchmark plan and live run; provider authentication is not verified."
      : "Ready for local validation and tests.",
  );
}

function checkAgent(config, id) {
  const normalized = id.toLowerCase();
  const runtime = config.runtimeAliases.find(
    (item) => item.id === normalized || item.aliases?.includes(normalized),
  );
  const profileId = runtime?.profile || normalized;
  const profile = config.agents.find(
    (item) => item.id === profileId || item.aliases?.includes(profileId),
  );
  if (!profile) return record(`Agent ${id}`, false, "unknown agent ID");
  const command =
    runtime?.id === "codex-cli"
      ? findCodexCliExe(root)
      : process.env[profile.commandEnv] || profile.defaultCommand;
  checkCommand(`Agent ${id}`, command, helpArgs(runtime?.kind || profile.id));
}

function helpArgs(kind) {
  return kind === "tura" ? ["--help"] : ["--version"];
}

function checkFile(label, file) {
  record(label, fs.existsSync(file), file);
}

function checkVersion(label, command, commandArgs, major, minor = 0) {
  const result = execute(command, commandArgs);
  const match = result.output.match(/(\d+)\.(\d+)/);
  const ok =
    result.ok &&
    match &&
    (Number(match[1]) > major ||
      (Number(match[1]) === major && Number(match[2]) >= minor));
  record(
    label,
    Boolean(ok),
    result.output || result.error || `${major}.${minor}+ required`,
  );
}

function checkCommand(label, command, commandArgs) {
  const result = execute(command, commandArgs);
  record(label, result.ok, result.output || result.error);
}

function execute(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    output: firstLine(result.stdout || result.stderr),
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

function record(label, ok, detail = "") {
  checks.push({ label, ok, detail: firstLine(detail) });
}

function takeFlag(name) {
  const index = argv.indexOf(name);
  if (index < 0) return false;
  argv.splice(index, 1);
  return true;
}

function takeValue(name) {
  const inline = argv.findIndex((item) => item.startsWith(`${name}=`));
  if (inline >= 0) return argv.splice(inline, 1)[0].slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0) return null;
  if (!argv[index + 1] || argv[index + 1].startsWith("--"))
    fail(`${name} requires a value`);
  return argv.splice(index, 2)[1];
}

function split(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstLine(value) {
  return String(value || "")
    .trim()
    .split(/\r?\n/, 1)[0];
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
