import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { npmInvocation } from "../lib/npm_runtime.mjs";
import { projectPython } from "../lib/python_runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("setup and doctor expose cost-free help without installing anything", () => {
  for (const script of ["setup.mjs", "doctor.mjs"]) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts", script), "--help"],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
});

test("repository Python prefers PYTHON and then the project virtual environment", () => {
  assert.equal(
    projectPython(root, { PYTHON: "custom-python" }),
    "custom-python",
  );
  const resolved = projectPython(root, {});
  const expected = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  assert.equal(resolved, fs.existsSync(expected) ? expected : "python");
});

test("npm invocation avoids spawning the Windows command shim directly", () => {
  const invocation = npmInvocation({});
  if (process.platform === "win32") {
    assert.notEqual(invocation.command, "npm.cmd");
  }
  const result = spawnSync(
    invocation.command,
    [...invocation.args, "--version"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /^\d+\.\d+/);
});

test("package scripts install and validate through repository-owned entry points", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(packageJson.scripts.setup, "node scripts/setup.mjs");
  assert.equal(packageJson.scripts.doctor, "node scripts/doctor.mjs");
  assert.match(packageJson.scripts["schema:check"], /scripts\/python\.mjs/);
  assert.ok(fs.existsSync(path.join(root, "requirements.txt")));
});
