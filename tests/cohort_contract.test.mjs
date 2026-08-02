import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCohortExecution,
  createPilotCohort,
  minimumDetectableEffect,
  storeFrozenCohort,
  validateCohortContract,
} from "../lib/cohort_contract.mjs";

function fullContract() {
  const inputs = {
    variance_estimate: 400,
    alpha: 0.05,
    target_power: 0.8,
    task_count: 2,
    replicate_count: 3,
  };
  return {
    schema: "tura.benchmark.cohort.v1",
    selection_plan_revision: "cohort-2026-08-02",
    frozen_at: "2026-08-02T00:00:00.000Z",
    pilot: false,
    eligible_task_pool: ["a", "b", "excluded"],
    selected_tasks: ["a", "b"],
    exclusions: [
      { task: "excluded", reason: "pre-registered unsupported runtime" },
    ],
    paired_unit: "task",
    task_count: 2,
    replicate_count: 3,
    primary_endpoint: "tokens",
    variance_estimate: 400,
    variance_estimates: { tokens: 400, cost: 0.04 },
    alpha: 0.05,
    target_power: 0.8,
    minimum_detectable_effect: minimumDetectableEffect(inputs),
    power_calculation: {
      revision: "paired-normal-v1",
      command: "node scripts/cohort.mjs power",
      inputs,
    },
  };
}

test("full cohorts freeze selection, exclusions, and reproducible power inputs", () => {
  const contract = fullContract();
  assert.equal(validateCohortContract(contract), contract);
  assert.doesNotThrow(() => assertCohortExecution(contract, ["b", "a"], 3));
  assert.throws(
    () => assertCohortExecution(contract, ["a"], 3),
    /task set differs/,
  );
  assert.throws(
    () => assertCohortExecution(contract, ["a", "b"], 2),
    /replicate count differs/,
  );
});

test("pilot cohorts are reduced but explicitly marked", () => {
  const pilot = createPilotCohort(
    ["task"],
    1,
    new Date("2026-08-02T00:00:00Z"),
  );
  assert.equal(pilot.pilot, true);
  assert.equal(pilot.task_count, 1);
  assert.equal(pilot.primary_endpoint, null);
});

test("frozen cohort storage is immutable and reconstructs execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tura-cohort-"));
  const contract = fullContract();
  const file = storeFrozenCohort(root, contract);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), contract);
  assert.equal(storeFrozenCohort(root, contract), file);
  assert.throws(
    () => storeFrozenCohort(root, { ...contract, primary_endpoint: "cost" }),
    /frozen cohort changed/,
  );
});

test("full cohorts reject missing exclusion and power evidence", () => {
  const contract = fullContract();
  assert.throws(
    () => validateCohortContract({ ...contract, exclusions: [] }),
    /missing exclusion reason/,
  );
  assert.throws(
    () =>
      validateCohortContract({
        ...contract,
        minimum_detectable_effect: 1,
      }),
    /does not match versioned power inputs/,
  );
});
