import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REPOSITORY_TASK_SCHEMA = "tura.benchmark.repository-task.v1";

export function loadRepositoryTask(file, root = process.cwd()) {
  const contractPath = path.resolve(root, file);
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  validateRepositoryTask(contract);
  return { contract, contractPath };
}

export function validateRepositoryTask(contract) {
  assert.equal(contract?.schema, REPOSITORY_TASK_SCHEMA);
  assert.match(String(contract.id || ""), /^[A-Za-z0-9._-]+$/);
  assert(
    contract.repository?.url || contract.repository?.path,
    "repository.url or repository.path is required",
  );
  assert(String(contract.repository.base_revision || "").trim());
  for (const name of ["setup", "baseline", "treatment"])
    validateCommand(contract.commands?.[name], `commands.${name}`);
  if (contract.validation?.adapter)
    assert(String(contract.validation.adapter).trim());
  else validateCommand(contract.validation?.command, "validation.command");
  assert(Array.isArray(contract.acceptance_criteria));
  assert(Array.isArray(contract.artifact_paths));
  assert(Number(contract.timeout_ms) > 0, "timeout_ms must be positive");
  assert(
    ["preserve", "quarantine", "remove"].includes(contract.cleanup_policy),
  );
  assert(String(contract.model?.provider || "").trim());
  assert(String(contract.model?.id || "").trim());
  return contract;
}

export function repositoryTaskPlan(contract, options = {}) {
  validateRepositoryTask(contract);
  const contractRoot = path.resolve(options.contractRoot || process.cwd());
  const repository = contract.repository.path
    ? path.resolve(contractRoot, contract.repository.path)
    : contract.repository.url;
  return {
    schema: REPOSITORY_TASK_SCHEMA,
    id: contract.id,
    repository,
    base_revision: contract.repository.base_revision,
    commands: structuredClone(contract.commands),
    model: structuredClone(contract.model),
    output: structuredClone(contract.output),
    environment: structuredClone(contract.environment || {}),
    validation: structuredClone(contract.validation),
    artifact_paths: [...contract.artifact_paths],
    timeout_ms: contract.timeout_ms,
    cleanup_policy: contract.cleanup_policy,
    preset: contract.preset || null,
  };
}

export async function runRepositoryTask(contract, options) {
  validateRepositoryTask(contract);
  assert(["baseline", "treatment"].includes(options.arm));
  const outputRoot = path.resolve(options.outputRoot);
  fs.mkdirSync(outputRoot, { recursive: false });
  const workspace = path.join(outputRoot, "workspace");
  await prepareRepository(contract, workspace, options.contractRoot);
  assertEnvironment(contract.environment, options.env || process.env);
  const env = {
    ...(options.env || process.env),
    ...(contract.environment?.values || {}),
  };
  const records = [];
  try {
    records.push(
      await executeCommand(
        contract.commands.setup,
        workspace,
        env,
        contract.timeout_ms,
      ),
    );
    records.push(
      await executeCommand(
        contract.commands[options.arm],
        workspace,
        env,
        contract.timeout_ms,
      ),
    );
    const validation = await validateRepositoryTaskRun(contract, {
      workspace,
      env,
      contractRoot: options.contractRoot,
    });
    const artifacts = collectRepositoryTaskArtifacts(
      contract,
      workspace,
      path.join(outputRoot, "artifacts"),
    );
    const result = resultManifest(
      contract,
      options.arm,
      workspace,
      records,
      validation,
      artifacts,
    );
    writeJson(path.join(outputRoot, "result-manifest.json"), result);
    return result;
  } catch (error) {
    writeJson(path.join(outputRoot, "failure.json"), {
      schema: "tura.benchmark.repository-task-failure.v1",
      task_id: contract.id,
      arm: options.arm,
      cleanup_policy: contract.cleanup_policy,
      error: String(error.stack || error),
      records,
    });
    if (contract.cleanup_policy === "remove")
      fs.rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

export async function validateRepositoryTaskRun(contract, options) {
  if (contract.validation.adapter) {
    const adapterPath = path.resolve(
      options.contractRoot || process.cwd(),
      contract.validation.adapter,
    );
    const adapter = await import(pathToFileURL(adapterPath).href);
    assert.equal(
      typeof adapter.validate,
      "function",
      "validator adapter must export validate",
    );
    return adapter.validate({ contract, ...options });
  }
  const record = await executeCommand(
    contract.validation.command,
    options.workspace,
    options.env || process.env,
    contract.timeout_ms,
  );
  const expected = contract.validation.expected || {};
  assert.equal(record.exit_code, expected.exit_code ?? 0, record.stderr);
  if (expected.stdout_includes)
    assert.match(
      record.stdout,
      new RegExp(escapeRegExp(expected.stdout_includes)),
    );
  return { adapter: "command", passed: true, record };
}

export function collectRepositoryTaskArtifacts(contract, workspace, output) {
  fs.mkdirSync(output, { recursive: true });
  const collected = [];
  for (const relative of contract.artifact_paths) {
    const source = path.resolve(workspace, relative);
    assertInside(workspace, source);
    assert(fs.existsSync(source), `missing declared artifact: ${relative}`);
    const target = path.resolve(output, relative);
    assertInside(output, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    collected.push({ source: relative, output: path.relative(output, target) });
  }
  return collected;
}

async function prepareRepository(
  contract,
  workspace,
  contractRoot = process.cwd(),
) {
  if (contract.repository.path) {
    const source = path.resolve(contractRoot, contract.repository.path);
    assert(fs.existsSync(source), `repository path does not exist: ${source}`);
    fs.cpSync(source, workspace, { recursive: true });
  } else {
    await executeCommand(
      ["git", "clone", "--no-checkout", contract.repository.url, workspace],
      path.dirname(workspace),
      process.env,
      contract.timeout_ms,
    );
  }
  if (contract.repository.base_revision !== "WORKTREE")
    await executeCommand(
      ["git", "checkout", "--detach", contract.repository.base_revision],
      workspace,
      process.env,
      contract.timeout_ms,
    );
}

function executeCommand(argv, cwd, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const [command, ...args] = argv;
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(
        new Error(`command timed out after ${timeoutMs}ms: ${argv.join(" ")}`),
      );
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const record = {
        command: [...argv],
        exit_code: code,
        signal,
        stdout,
        stderr,
        duration_ms: Date.now() - started,
      };
      if (code === 0) resolve(record);
      else
        reject(
          Object.assign(new Error(stderr || `command exited ${code}`), {
            record,
          }),
        );
    });
  });
}

function resultManifest(
  contract,
  arm,
  workspace,
  records,
  validation,
  artifacts,
) {
  return {
    schema: "tura.benchmark.repository-task-result.v1",
    task_id: contract.id,
    repository: contract.repository,
    arm,
    model: contract.model,
    output: contract.output,
    workspace,
    commands: records,
    validation,
    artifacts,
    timeout_ms: contract.timeout_ms,
    cleanup_policy: contract.cleanup_policy,
  };
}

function assertEnvironment(environment = {}, env) {
  const missing = (environment.required || []).filter((name) => !env[name]);
  assert(
    missing.length === 0,
    `missing required environment: ${missing.join(", ")}`,
  );
}

function validateCommand(command, label) {
  assert(
    Array.isArray(command) && command.length > 0,
    `${label} must be an argv array`,
  );
  assert(
    command.every((item) => typeof item === "string"),
    `${label} must contain strings`,
  );
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
