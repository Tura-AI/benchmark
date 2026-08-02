import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadRepositoryTask,
  repositoryTaskPlan,
  runRepositoryTask,
  validateRepositoryTaskRun,
} from "../lib/repository_task.mjs";

const fixture = path.resolve("tests/fixtures/repository-task/task.json");

test("repository task plan exposes every reproducibility input", () => {
  const { contract, contractPath } = loadRepositoryTask(fixture);
  const plan = repositoryTaskPlan(contract, {
    contractRoot: path.dirname(contractPath),
  });
  assert.ok(path.isAbsolute(plan.repository));
  assert.deepEqual(Object.keys(plan.commands).sort(), [
    "baseline",
    "setup",
    "treatment",
  ]);
  assert.equal(plan.model.provider, "fixture");
  assert.deepEqual(plan.validation.command, ["node", "validate.mjs"]);
  assert.deepEqual(plan.artifact_paths, ["output.txt"]);
  assert.equal(plan.timeout_ms, 10000);
});

test("a repository task runs from a clean declared checkout", async () => {
  const { contract, contractPath } = loadRepositoryTask(fixture);
  const outputRoot = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tura-repository-task-")),
    "run",
  );
  const result = await runRepositoryTask(contract, {
    arm: "baseline",
    outputRoot,
    contractRoot: path.dirname(contractPath),
    env: process.env,
  });
  assert.equal(result.validation.passed, true);
  assert.deepEqual(result.artifacts, [
    { source: "output.txt", output: "output.txt" },
  ]);
  assert.equal(
    fs.readFileSync(path.join(outputRoot, "artifacts", "output.txt"), "utf8"),
    "FIXTURE\n",
  );
});

test("Bash/Ollama preset declares all machine dependencies", () => {
  const preset = JSON.parse(
    fs.readFileSync("config/repository-task-presets/bash-ollama.json", "utf8"),
  );
  assert.deepEqual(preset.shell, ["bash", "-lc"]);
  assert.equal(preset.provider, "ollama");
  assert.deepEqual(preset.required_environment, ["OLLAMA_HOST"]);
  assert.deepEqual(preset.healthcheck, ["ollama", "list"]);
});

test("task-specific validation loads as an adapter", async () => {
  const { contract, contractPath } = loadRepositoryTask(fixture);
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-validator-adapter-"),
  );
  fs.writeFileSync(path.join(root, "output.txt"), "FIXTURE\n");
  const validation = await validateRepositoryTaskRun(
    {
      ...contract,
      validation: { adapter: "validator.mjs" },
    },
    {
      workspace: root,
      contractRoot: path.dirname(contractPath),
    },
  );
  assert.deepEqual(validation, {
    adapter: "fixture-validator",
    passed: true,
  });
});
