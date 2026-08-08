import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const INTERVENTION_SCHEMA = "tura.benchmark.intervention.v1";

export function loadIntervention(file, repoRoot = process.cwd()) {
  const contractPath = path.resolve(repoRoot, file);
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  validateIntervention(contract);
  return { ...contract, contract_path: contractPath };
}

export function validateIntervention(contract) {
  assert.equal(contract?.schema, INTERVENTION_SCHEMA);
  assert.match(String(contract.name || ""), /^[A-Za-z0-9._-]+$/);
  assert(
    String(contract.revision || "").trim(),
    "intervention revision is required",
  );
  assert(
    Array.isArray(contract.files || []),
    "intervention files must be an array",
  );
  for (const file of contract.files || []) {
    assert(
      ["context", "skill"].includes(file.kind),
      `invalid injected file kind: ${file.kind}`,
    );
    assert(
      file.source && file.target,
      "injected file requires source and target",
    );
  }
  assert(
    contract.setup_command == null || Array.isArray(contract.setup_command),
    "setup_command must be an argv array",
  );
  assert(
    contract.wrapper == null || Array.isArray(contract.wrapper),
    "wrapper must be an argv array",
  );
  return contract;
}

export function interventionPlan(contract, arm) {
  assert(
    ["baseline", "treatment"].includes(arm),
    `invalid intervention arm: ${arm}`,
  );
  const treatment = arm === "treatment";
  return {
    schema: INTERVENTION_SCHEMA,
    name: contract.name,
    revision: contract.revision,
    arm,
    injected_files: treatment
      ? (contract.files || []).map(({ kind, source, target }) => ({
          kind,
          source,
          target,
        }))
      : [],
    setup_command: treatment ? contract.setup_command || null : null,
    wrapper: treatment ? contract.wrapper || null : null,
    configuration_diff: treatment
      ? [
          ...(contract.files || []).map((file) => `file:${file.target}`),
          ...Object.keys(contract.environment || {}).map((key) => `env:${key}`),
          ...(contract.setup_command ? ["setup_command"] : []),
          ...(contract.wrapper ? ["wrapper"] : []),
        ]
      : [],
  };
}

export function assertInterventionPair(baseline, treatment, contract) {
  assert.equal(baseline.intervention?.arm, "baseline");
  assert.equal(treatment.intervention?.arm, "treatment");
  for (const field of ["task", "agent", "replicate", "runner"]) {
    assert.deepEqual(
      treatment[field],
      baseline[field],
      `undeclared intervention drift: ${field}`,
    );
  }
  const allowedEnvironment = new Set([
    "COMMAND_RUN_AGENT_RUN_ID",
    "TURA_BENCHMARK_INTERVENTION",
    "TURA_BENCHMARK_INTERVENTION_ARM",
    ...Object.keys(contract.environment || {}),
  ]);
  const baselineEnv = omitKeys(baseline.env, allowedEnvironment);
  const treatmentEnv = omitKeys(treatment.env, allowedEnvironment);
  assert.deepEqual(
    treatmentEnv,
    baselineEnv,
    "undeclared intervention environment drift",
  );
  return true;
}

export function applyIntervention(workspace, contract, options = {}) {
  validateIntervention(contract);
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const workspaceRoot = path.resolve(workspace);
  const injectedFiles = [];
  const context = [];
  for (const file of contract.files || []) {
    const source = path.resolve(repoRoot, file.source);
    const target = path.resolve(workspaceRoot, file.target);
    assertInside(workspaceRoot, target);
    assert(fs.existsSync(source), `missing intervention source: ${source}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    injectedFiles.push({
      kind: file.kind,
      source,
      target,
      sha256: fs.statSync(target).isFile() ? sha256(target) : null,
    });
    if (file.kind === "context" && fs.statSync(target).isFile())
      context.push(fs.readFileSync(target, "utf8"));
  }
  if (contract.setup_command?.length) {
    const [command, ...args] = contract.setup_command;
    const result = spawnSync(command, args, {
      cwd: workspaceRoot,
      env: { ...process.env, ...(contract.environment || {}) },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      result.stderr || result.error?.message || "intervention setup failed",
    );
  }
  return {
    ...interventionPlan(contract, "treatment"),
    injected_files: injectedFiles,
    context_text: context.join("\n\n"),
    environment: { ...(contract.environment || {}) },
  };
}

export function wrapInterventionCommand(commandSpec, contract) {
  if (!contract.wrapper?.length) return commandSpec;
  const [command, ...prefix] = contract.wrapper;
  return {
    ...commandSpec,
    command,
    args: [...prefix, commandSpec.command, ...commandSpec.args],
  };
}

function omitKeys(value, keys) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([key]) => !keys.has(key)),
  );
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `intervention target escapes workspace: ${target}`,
  );
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}
