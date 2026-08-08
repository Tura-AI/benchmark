import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { npmInvocation } from "../lib/npm_runtime.mjs";
import {
  projectPython,
  resolvePythonInterpreter,
} from "../lib/python_runtime.mjs";

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

test("repository Python resolves virtualenv before an explicit path", () => {
  const virtualenv = path.resolve(root, ".venv", "bin", "python");
  const resolved = resolvePythonInterpreter(root, {
    platform: "darwin",
    env: { TURA_BENCHMARK_PYTHON: "/configured/python" },
    exists: (file) => [virtualenv, "/configured/python"].includes(file),
    inspectVersion: () => "3.12.4",
  });
  assert.deepEqual(resolved, {
    path: virtualenv,
    version: "3.12.4",
    source: "project-virtualenv",
  });
});

test("repository Python uses an explicit interpreter before PATH", () => {
  const configured = path.join(root, "configured-python");
  const resolved = resolvePythonInterpreter(root, {
    platform: "darwin",
    env: { PYTHON: configured },
    exists: (file) => file === configured,
    findExecutable: (command) => `/path/${command}`,
    inspectVersion: () => "3.11.9",
  });
  assert.equal(resolved.path, configured);
  assert.equal(resolved.source, "environment:PYTHON");
});

test("repository Python falls back to python3 before python", () => {
  const lookedUp = [];
  const resolved = resolvePythonInterpreter(root, {
    platform: "darwin",
    env: {},
    exists: (file) => file === "/usr/bin/python3",
    findExecutable(command) {
      lookedUp.push(command);
      return command === "python3" ? "/usr/bin/python3" : "/usr/bin/python";
    },
    inspectVersion: () => "3.11.0",
  });
  assert.equal(resolved.path, path.resolve("/usr/bin/python3"));
  assert.equal(resolved.source, "path:python3");
  assert.deepEqual(lookedUp, ["python3"]);
});

test("repository Python rejects missing and unsupported interpreters", () => {
  assert.throws(
    () =>
      resolvePythonInterpreter(root, {
        platform: "darwin",
        env: {},
        exists: () => false,
        findExecutable: () => null,
        inspectVersion: () => null,
      }),
    /Python 3\.11 or newer was not found/,
  );
  assert.throws(
    () =>
      resolvePythonInterpreter(root, {
        platform: "darwin",
        env: { PYTHON: path.join(root, "old-python") },
        exists: (file) => file === path.join(root, "old-python"),
        findExecutable: () => null,
        inspectVersion: () => "3.10.14",
      }),
    /Unsupported candidates: .*3\.10\.14/,
  );
});

test("projectPython keeps the resolved-path compatibility API", () => {
  const resolved = projectPython(root, {});
  assert.equal(path.isAbsolute(resolved), true);
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
