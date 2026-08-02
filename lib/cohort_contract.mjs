import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export const COHORT_SCHEMA = "tura.benchmark.cohort.v1";
export const POWER_CALCULATION_REVISION = "paired-normal-v1";

export function loadCohortContract(file, root = process.cwd()) {
  const contractPath = path.resolve(root, file);
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  validateCohortContract(contract);
  return { contract, contractPath };
}

export function validateCohortContract(contract) {
  assert.equal(contract?.schema, COHORT_SCHEMA);
  assert(String(contract.selection_plan_revision || "").trim());
  assert(
    Number.isFinite(Date.parse(contract.frozen_at)),
    "invalid cohort freeze timestamp",
  );
  assert.equal(
    typeof contract.pilot,
    "boolean",
    "cohort pilot flag is required",
  );
  assertUnique(contract.eligible_task_pool, "eligible_task_pool");
  assertUnique(contract.selected_tasks, "selected_tasks");
  const eligible = new Set(contract.eligible_task_pool);
  for (const task of contract.selected_tasks)
    assert(eligible.has(task), `selected task is not eligible: ${task}`);
  assert.equal(contract.task_count, contract.selected_tasks.length);
  assertPositiveInteger(contract.replicate_count, "replicate_count");
  const exclusions = new Map(
    (contract.exclusions || []).map((item) => [item.task, item.reason]),
  );
  for (const task of contract.eligible_task_pool) {
    if (!contract.selected_tasks.includes(task))
      assert(
        String(exclusions.get(task) || "").trim(),
        `missing exclusion reason: ${task}`,
      );
  }
  if (!contract.pilot) {
    assert(
      String(contract.paired_unit || "").trim(),
      "paired_unit is required",
    );
    assert(
      String(contract.primary_endpoint || "").trim(),
      "primary_endpoint is required",
    );
    assert(
      Number(contract.variance_estimate) > 0,
      "variance_estimate must be positive",
    );
    assertProbability(contract.alpha, "alpha");
    assertProbability(contract.target_power, "target_power");
    assert(Number(contract.minimum_detectable_effect) > 0);
    assert.equal(
      contract.power_calculation?.revision,
      POWER_CALCULATION_REVISION,
    );
    assert.equal(
      contract.power_calculation?.command,
      "node scripts/cohort.mjs power",
    );
    assert.deepEqual(contract.power_calculation.inputs, {
      variance_estimate: contract.variance_estimate,
      alpha: contract.alpha,
      target_power: contract.target_power,
      task_count: contract.task_count,
      replicate_count: contract.replicate_count,
    });
    const calculated = minimumDetectableEffect(
      contract.power_calculation.inputs,
    );
    assert(
      Math.abs(calculated - Number(contract.minimum_detectable_effect)) < 1e-9,
      "minimum_detectable_effect does not match versioned power inputs",
    );
  }
  return contract;
}

export function createPilotCohort(tasks, replicateCount, now = new Date()) {
  const selected = [...tasks];
  return validateCohortContract({
    schema: COHORT_SCHEMA,
    selection_plan_revision: `pilot-${now.toISOString()}`,
    frozen_at: now.toISOString(),
    pilot: true,
    eligible_task_pool: selected,
    selected_tasks: selected,
    exclusions: [],
    paired_unit: "task",
    task_count: selected.length,
    replicate_count: replicateCount,
    primary_endpoint: null,
  });
}

export function assertCohortExecution(contract, tasks, replicateCount) {
  validateCohortContract(contract);
  assert.deepEqual(
    [...tasks].sort(),
    [...contract.selected_tasks].sort(),
    "executed task set differs from frozen cohort",
  );
  assert.equal(
    replicateCount,
    contract.replicate_count,
    "executed replicate count differs from frozen cohort",
  );
}

export function minimumDetectableEffect(inputs) {
  const variance = Number(inputs?.variance_estimate);
  const alpha = Number(inputs?.alpha);
  const power = Number(inputs?.target_power);
  const taskCount = Number(inputs?.task_count);
  const replicateCount = Number(inputs?.replicate_count);
  assert(variance > 0, "variance_estimate must be positive");
  assertProbability(alpha, "alpha");
  assertProbability(power, "target_power");
  assertPositiveInteger(taskCount, "task_count");
  assertPositiveInteger(replicateCount, "replicate_count");
  const standardError = Math.sqrt(variance / (taskCount * replicateCount));
  return (inverseNormal(1 - alpha / 2) + inverseNormal(power)) * standardError;
}

export function storeFrozenCohort(root, contract) {
  validateCohortContract(contract);
  const directory = path.resolve(root, "cohorts");
  fs.mkdirSync(directory, { recursive: true });
  const name = safeSegment(contract.selection_plan_revision);
  const target = path.join(directory, `${name}.json`);
  const content = `${JSON.stringify(contract, null, 2)}\n`;
  if (fs.existsSync(target)) {
    assert.equal(
      fs.readFileSync(target, "utf8"),
      content,
      `frozen cohort changed: ${target}`,
    );
    return target;
  }
  fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
  return target;
}

function inverseNormal(probability) {
  assertProbability(probability, "probability");
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269,
    -30.6647980661472, 2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197,
    -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878,
  ];
  const d = [
    0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function assertUnique(values, label) {
  assert(
    Array.isArray(values) && values.length > 0,
    `${label} must be non-empty`,
  );
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} contains duplicates`,
  );
}

function assertPositiveInteger(value, label) {
  assert(
    Number.isInteger(Number(value)) && Number(value) > 0,
    `${label} must be positive`,
  );
}

function assertProbability(value, label) {
  assert(
    Number(value) > 0 && Number(value) < 1,
    `${label} must be between zero and one`,
  );
}

function safeSegment(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
