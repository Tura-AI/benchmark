#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { npmInvocation } from "../lib/npm_runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage: node scripts/setup.mjs [--skip-node] [--skip-python]

Installs repository-owned Node and Python dependencies. It does not install or
authenticate Docker, Git, or agent CLIs.`);
  process.exit(0);
}

for (const item of args)
  assert(
    ["--skip-node", "--skip-python"].includes(item),
    `unknown option: ${item}`,
  );

assertVersion("Node.js", process.versions.node, 20);

if (!args.has("--skip-node")) {
  const npm = npmInvocation();
  run(
    npm.command,
    [...npm.args, "ci", "--no-audit", "--no-fund"],
    "install Node dependencies",
  );
}

if (!args.has("--skip-python")) {
  const systemPython = findPython();
  const version = capture(systemPython.command, [
    ...systemPython.args,
    "--version",
  ]);
  assertVersion("Python", version.replace(/^Python\s+/i, ""), 3, 11);
  const venv = path.join(root, ".venv");
  const python = venvPython(venv);
  if (!fs.existsSync(python)) {
    run(
      systemPython.command,
      [...systemPython.args, "-m", "venv", venv],
      "create .venv",
    );
  }
  run(
    python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--requirement",
      path.join(root, "requirements.txt"),
    ],
    "install Python dependencies",
  );
}

console.log("Setup complete. Run `npm run doctor` and `npm test` next.");

function findPython() {
  const configured = process.env.PYTHON;
  const candidates = configured
    ? [{ command: configured, args: [] }]
    : process.platform === "win32"
      ? [
          { command: "py", args: ["-3"] },
          { command: "python", args: [] },
        ]
      : [
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ];
  for (const candidate of candidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.args, "--version"],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (result.status === 0) return candidate;
  }
  throw new Error("Python 3.11 or newer was not found on PATH");
}

function venvPython(venv) {
  return path.join(
    venv,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
}

function assertVersion(label, value, minimumMajor, minimumMinor = 0) {
  const [major, minor] = String(value).trim().split(".").map(Number);
  assert(
    Number.isInteger(major) &&
      (major > minimumMajor ||
        (major === minimumMajor && minor >= minimumMinor)),
    `${label} ${minimumMajor}.${minimumMinor}+ is required; found ${value}`,
  );
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || `failed: ${command}`);
  return String(result.stdout || result.stderr || "").trim();
}

function run(command, commandArgs, label) {
  console.log(`[setup] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `failed to ${label}`);
}
