import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyIntervention,
  assertInterventionPair,
  interventionPlan,
  loadIntervention,
  wrapInterventionCommand,
} from "../lib/intervention.mjs";

test("serializer and CJK fixtures use the same versioned contract", () => {
  for (const name of ["plain-text-serializer", "cjk-reducer"]) {
    const contract = loadIntervention(
      `config/interventions/${name}.json`,
      process.cwd(),
    );
    assert.equal(contract.schema, "tura.benchmark.intervention.v1");
    assert.equal(contract.name, name);
    assert.ok(contract.revision);
  }
});

test("baseline and treatment reject undeclared configuration drift", () => {
  const contract = loadIntervention(
    "config/interventions/plain-text-serializer.json",
  );
  const core = {
    task: "task",
    agent: "codex-cli",
    replicate: 1,
    runner: "runner.mjs",
    env: { MODEL: "same", TURA_SERIALIZER: "plain-text" },
  };
  const baseline = {
    ...core,
    env: { MODEL: "same" },
    intervention: interventionPlan(contract, "baseline"),
  };
  const treatment = {
    ...core,
    intervention: interventionPlan(contract, "treatment"),
  };
  assert.equal(assertInterventionPair(baseline, treatment, contract), true);
  assert.throws(
    () =>
      assertInterventionPair(
        baseline,
        { ...treatment, env: { ...treatment.env, MODEL: "drifted" } },
        contract,
      ),
    /undeclared intervention environment drift/,
  );
});

test("treatment injects declared files and records their hashes", () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-intervention-"),
  );
  const contract = loadIntervention(
    "config/interventions/plain-text-serializer.json",
  );
  const applied = applyIntervention(workspace, contract, {
    repoRoot: process.cwd(),
  });
  assert.equal(applied.arm, "treatment");
  assert.equal(applied.injected_files.length, 1);
  assert.match(applied.injected_files[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(applied.context_text, /deterministic plain text/);
  assert.equal(applied.environment.TURA_SERIALIZER, "plain-text");
});

test("setup commands and wrappers use the same declared intervention", () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-intervention-setup-"),
  );
  const contract = {
    schema: "tura.benchmark.intervention.v1",
    name: "setup-and-wrapper",
    revision: "1",
    files: [],
    setup_command: [
      process.execPath,
      "-e",
      "require('fs').writeFileSync('setup-ran.txt', 'yes')",
    ],
    wrapper: ["wrapper", "--deterministic"],
  };
  const applied = applyIntervention(workspace, contract);
  assert.equal(
    fs.readFileSync(path.join(workspace, "setup-ran.txt"), "utf8"),
    "yes",
  );
  assert.deepEqual(
    wrapInterventionCommand({ command: "agent", args: ["run"] }, contract),
    {
      command: "wrapper",
      args: ["--deterministic", "agent", "run"],
    },
  );
  assert.deepEqual(applied.configuration_diff, ["setup_command", "wrapper"]);
});
