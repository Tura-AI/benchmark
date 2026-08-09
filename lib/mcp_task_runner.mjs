import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

import { genericAgentKind, runGenericAgentCli } from "./generic_agent_cli.mjs";
import {
  codexMcpConfigOverrides,
  loadMcpAgentAdapters,
  resolveMcpServerLaunch,
  turaCommandAdapterEnvironment,
} from "./mcp_agent_adapters.mjs";
import { startMcpStdioBroker } from "./mcp_stdio_broker.mjs";

const TASK_REPORT_SCHEMA = "tura.benchmark.task-report.v1";
const HARNESS_REPORT_SCHEMA = "tura.benchmark.harness-report.v2";

export async function runMcpTask(taskDirectory) {
  const startedAt = new Date().toISOString();
  const taskDir = path.resolve(taskDirectory);
  const repoRoot = path.resolve(taskDir, "..", "..", "..");
  const taskRelativeDirectory = path
    .relative(repoRoot, taskDir)
    .replaceAll("\\", "/");
  const task = readJson(path.join(taskDir, "task.json"));
  const harness = readJson(path.join(taskDir, "harness.json"));
  const prompt = fs.readFileSync(path.join(taskDir, "prompt.md"), "utf8");
  const runId =
    process.env.COMMAND_RUN_AGENT_RUN_ID || `${task.id}-${Date.now()}`;
  const agentId = String(
    process.env.COMMAND_RUN_AGENT_AGENTS || "codex-cli",
  ).split(",")[0];
  const runDirectory = path.resolve(
    process.env.TURA_BENCHMARK_RUN_DIRECTORY ||
      path.join(process.cwd(), "raw", "mcp", runId),
  );
  const workspace = path.join(runDirectory, "workspace");
  const agentDirectory = path.join(runDirectory, "agent");
  const contractsDirectory = path.join(runDirectory, "metadata", "contracts");
  const harnessDirectory = path.join(runDirectory, "harness");
  const mcpDirectory = path.join(runDirectory, "mcp");
  const tracePath = path.join(mcpDirectory, "trace.jsonl");
  const statePath = path.join(mcpDirectory, "state.json");
  const fixture = path.join(taskDir, "fixture");
  const server = path.join(taskDir, "mcp_server.py");
  const verifier = path.join(taskDir, "verify.py");
  const scenarioPath =
    task.mcp?.mode === "stateful-workflow"
      ? path.join(taskDir, "scenario.json")
      : null;
  const workflowScenario = scenarioPath ? readJson(scenarioPath) : null;

  for (const required of [fixture, server, verifier, scenarioPath].filter(
    Boolean,
  )) {
    assert(fs.existsSync(required), `missing task artifact: ${required}`);
  }
  mkdirp(runDirectory);
  fs.cpSync(fixture, workspace, { recursive: true, force: true });
  mkdirp(agentDirectory);
  mkdirp(contractsDirectory);
  mkdirp(harnessDirectory);
  mkdirp(mcpDirectory);
  initializeGit(workspace);
  const startSnapshot = repositorySnapshot(workspace, runDirectory);

  const { manifest: adapters } = loadMcpAgentAdapters(taskDir);
  const mcpLaunch = resolveMcpServerLaunch(adapters, {
    python: pythonCommand(),
    taskDir,
    workspace,
    tracePath,
    scenarioPath,
    statePath,
  });
  let agentResult = null;
  if (truthy(process.env.TURA_MCP_SELF_TEST)) {
    await probeMcpServer(mcpLaunch, workflowScenario?.selfTest?.calls);
  } else {
    const isCodex = agentId === "codex-cli";
    const isTura = genericAgentKind(agentId) === "tura";
    assert(
      isCodex || isTura,
      `MCP tasks require codex-cli or a Tura runtime agent; received ${agentId}`,
    );
    const turaAdapter = adapters.adapters.turaCommand;
    const turaCapabilityDirectory = path.resolve(
      taskDir,
      turaAdapter.packageDirectory,
    );
    const bridgeBinary =
      process.env.TURA_MCP_STDIO_BRIDGE_BIN ||
      path.join(
        repoRoot,
        "target",
        "debug",
        process.platform === "win32"
          ? "tura-command-mcp-stdio-bridge.exe"
          : "tura-command-mcp-stdio-bridge",
      );
    if (isTura) {
      assert(
        fs.existsSync(turaCapabilityDirectory),
        `missing Tura MCP command package: ${turaCapabilityDirectory}`,
      );
      assert(
        fs.existsSync(bridgeBinary),
        `missing Tura MCP bridge binary: ${bridgeBinary}; run npm run mcp:tura-bridge:build`,
      );
    }
    const broker = isTura ? await startMcpStdioBroker(mcpLaunch) : null;
    try {
      agentResult = await runGenericAgentCli({
        agentId,
        workspace,
        agentDir: agentDirectory,
        prompt,
        repoRoot,
        model: process.env.TURA_BENCHMARK_MODEL,
        reasoning: process.env.COMMAND_RUN_AGENT_REASONING_EFFORT || "medium",
        serviceTier: process.env.COMMAND_RUN_AGENT_SERVICE_TIER || "default",
        timeoutMs: Number(
          process.env.COMMAND_RUN_AGENT_TIMEOUT_MS || 60 * 60_000,
        ),
        codexCliConfig: isCodex
          ? codexMcpConfigOverrides(adapters, mcpLaunch)
          : [],
        turaCapabilityDirectories: isTura ? [turaCapabilityDirectory] : [],
        turaCommandEnv: isTura
          ? {
              ...turaCommandAdapterEnvironment(adapters, mcpLaunch),
              TURA_MCP_STDIO_BRIDGE_BIN: bridgeBinary,
              TURA_MCP_BROKER_ADDR: broker.address,
              TURA_MCP_BROKER_TOKEN: broker.token,
            }
          : {},
        turaHome: isTura ? path.join(agentDirectory, "tura-home") : null,
        turaDbRoot: isTura ? path.join(agentDirectory, "tura-db") : null,
        sessionLogDbRoot: isTura
          ? path.join(agentDirectory, "session-log-db")
          : null,
        env: { PYTHONDONTWRITEBYTECODE: "1" },
        turaProjectRoot: process.env.TURA_PROJECT_ROOT,
      });
    } finally {
      await broker?.stop();
    }
  }

  const verifierResult = runVerifier(verifier, workspace, {
    scenarioPath,
    statePath,
    tracePath,
  });
  fs.writeFileSync(
    path.join(harnessDirectory, "stdout.log"),
    verifierResult.stdout,
    "utf8",
  );
  fs.writeFileSync(
    path.join(harnessDirectory, "stderr.log"),
    verifierResult.stderr,
    "utf8",
  );
  const trace = readJsonLines(tracePath);
  const checks = evaluateChecks(trace, verifierResult, task, workflowScenario);
  const results = harness.scoreItems.map((rule) => {
    const check = checks[rule.id] || {
      passed: false,
      message: `runner has no evaluator for ${rule.id}`,
    };
    return {
      ...rule,
      status: check.passed ? "pass" : "fail",
      passed: check.passed,
      failure: check.passed
        ? null
        : {
            assertion: rule.id,
            message: check.message,
            actual: check.actual ?? null,
          },
    };
  });
  const passed = results.filter((item) => item.passed).length;
  const failed = results.length - passed;
  const ratio = results.length ? passed / results.length : 0;
  const status = failed === 0 ? "pass" : "fail";
  const score = {
    passed,
    failed,
    total: results.length,
    ratio,
    label: `${passed}/${results.length}`,
  };
  const harnessReport = {
    schema: HARNESS_REPORT_SCHEMA,
    id: `${runId}-harness`,
    runId,
    taskId: task.id,
    agentId,
    category: "mcp",
    taskContractPath: `${taskRelativeDirectory}/task.json`,
    harnessContractPath: `${taskRelativeDirectory}/harness.json`,
    status,
    score,
    results,
    artifacts: {
      stdoutPath: "harness/stdout.log",
      stderrPath: "harness/stderr.log",
      harnessDirectory: "harness",
      mcpTracePath: "mcp/trace.jsonl",
      mcpStatePath: workflowScenario ? "mcp/state.json" : null,
    },
    legacy: null,
  };
  writeJson(
    path.join(contractsDirectory, "harness-report.json"),
    harnessReport,
  );

  const diff = git(workspace, ["diff", "--binary", "--no-ext-diff", "HEAD"]);
  const diffPath = path.join(runDirectory, "git-diff.patch");
  fs.writeFileSync(diffPath, diff.stdout || "", "utf8");
  const endedAt = new Date().toISOString();
  const usage = normalizedUsage(agentResult?.usage_info?.usage);
  const rounds = Array.isArray(agentResult?.rounds) ? agentResult.rounds : [];
  const taskReport = {
    schema: TASK_REPORT_SCHEMA,
    runId,
    taskId: task.id,
    agentId,
    category: "mcp",
    metadata: {
      startedAt,
      endedAt,
      agentVersion: String(
        process.env.COMMAND_RUN_AGENT_CODEX_VERSION || "unknown",
      ),
      agentCliCommand: agentId,
    },
    usage: {
      ...usage,
      providerDurationMs: Number(
        agentResult?.usage_info?.provider_duration_ms || 0,
      ),
      llmRoundCount: rounds.length,
    },
    harnessScore: ratio,
    gitDiffPath: "git-diff.patch",
    harnessDirectory: "harness",
    startRepoSnapshot: startSnapshot,
    cliMetadataPath: "metadata/contracts/cli-metadata.json",
    roundsDirectory: "agent/rounds",
    rounds,
    sourceSummaryPath: null,
    mcp: {
      server: task.mcp.server,
      transport: "stdio",
      tracePath: "mcp/trace.jsonl",
      statePath: workflowScenario ? "mcp/state.json" : null,
      services: workflowScenario?.services || null,
      initialized: checks[`${task.id}-mcp-initialize`]?.passed || false,
      schemaListed: checks[`${task.id}-mcp-tools-list`]?.passed || false,
      toolCallCount: trace.filter((item) => item.method === "tools/call")
        .length,
    },
  };
  writeJson(path.join(contractsDirectory, "task-report.json"), taskReport);
  const cliMetadata = {
    schema: "tura.benchmark.cli-metadata.v1",
    software: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      systemSoftwareVersion: os.release(),
      packageName: agentId,
      packageVersion: String(
        process.env.COMMAND_RUN_AGENT_CODEX_VERSION || "unknown",
      ),
    },
    agent: {
      agentId,
      agentApplicationVersion: String(
        process.env.COMMAND_RUN_AGENT_CODEX_VERSION || "unknown",
      ),
      model: String(process.env.TURA_BENCHMARK_MODEL || "self-test"),
      effort: String(
        process.env.COMMAND_RUN_AGENT_REASONING_EFFORT || "medium",
      ),
    },
    createdAt: endedAt,
  };
  writeJson(path.join(contractsDirectory, "cli-metadata.json"), cliMetadata);
  const roundsJsonl = path.join(agentDirectory, "agent-rounds.jsonl");
  if (!fs.existsSync(roundsJsonl)) {
    fs.writeFileSync(
      roundsJsonl,
      rounds.map((round) => JSON.stringify(round)).join("\n") +
        (rounds.length ? "\n" : ""),
      "utf8",
    );
  }
  writeJson(path.join(contractsDirectory, "contract-manifest.json"), {
    schema: "tura.benchmark.contract-manifest.v1",
    runId,
    contracts: ["cli-metadata.json", "harness-report.json", "task-report.json"],
  });
  writeJson(path.join(runDirectory, "result.json"), {
    schema_version: "2.0.0",
    run_id: runId,
    task_id: task.id,
    agent_id: agentId,
    status,
    score,
    contracts: {
      task_report: "metadata/contracts/task-report.json",
      harness_report: "metadata/contracts/harness-report.json",
      manifest: "metadata/contracts/contract-manifest.json",
    },
  });
  process.stdout.write(
    `${JSON.stringify({ runId, taskId: task.id, status, score, runDirectory })}\n`,
  );
  process.exitCode = status === "pass" ? 0 : 1;
  return { taskReport, harnessReport, runDirectory };
}

export function evaluateChecks(trace, verifierResult, task, workflowScenario) {
  const taskId = task.id;
  const has = (method) => trace.some((item) => item.method === method);
  const methods = trace.map((item) => item.method);
  const initializeIndex = methods.indexOf("initialize");
  const initializedIndex = methods.indexOf("notifications/initialized");
  const listIndex = methods.indexOf("tools/list");
  const initializeResult =
    initializeIndex >= 0 ? trace[initializeIndex]?.response : null;
  const lifecycleValid =
    initializeIndex >= 0 &&
    initializeIndex < initializedIndex &&
    initializedIndex < listIndex &&
    initializeResult?.protocolVersion === "2025-06-18" &&
    Boolean(initializeResult?.capabilities?.tools);
  const toolCalls = trace.filter((item) => item.method === "tools/call");
  const writes = toolCalls.filter((item) =>
    ["write_file", "make_directory", "move_file", "delete_file"].includes(
      item.params?.name,
    ),
  );
  const checks = {
    [`${taskId}-mcp-initialize`]: {
      passed: lifecycleValid,
      message: "MCP lifecycle/version/capability negotiation was incomplete",
      actual: { methods, initializeResult },
    },
    [`${taskId}-mcp-tools-list`]: {
      passed: has("tools/list"),
      message: "MCP tools/list schema discovery was not observed",
      actual: trace.map((item) => item.method),
    },
    [`${taskId}-mcp-write-tool`]: {
      passed: writes.length > 0,
      message:
        "the agent did not modify the workspace through an MCP write tool",
      actual: toolCalls.map((item) => item.params?.name),
    },
    [`${taskId}-task-behavior`]: {
      passed: verifierResult.status === 0,
      message:
        verifierResult.stderr || verifierResult.stdout || "verifier failed",
      actual: verifierResult.status,
    },
  };
  if (workflowScenario) {
    const expectedTools = workflowScenario.steps.map((step) => step.tool);
    const expectedListedTools = [...new Set(expectedTools)];
    const listedTools = trace
      .find((item) => item.method === "tools/list")
      ?.response?.tools?.map((tool) => tool.name);
    const successfulCalls = toolCalls.filter((item) => !item.response?.isError);
    const successfulNames = successfulCalls.map((item) => item.params?.name);
    const toolErrors = toolCalls.filter((item) => item.response?.isError);
    const assignment = assignWorkflowCalls(successfulCalls, workflowScenario);
    const listedDefinitions = trace.find((item) => item.method === "tools/list")
      ?.response?.tools;
    const listedContractsValid =
      Array.isArray(listedDefinitions) &&
      listedDefinitions.length === expectedListedTools.length &&
      new Set(listedTools).size === listedTools.length &&
      workflowScenario.steps.every((step) => {
        const listed = listedDefinitions.find(
          (tool) => tool.name === step.tool,
        );
        return (
          listed &&
          JSON.stringify(listed.inputSchema) ===
            JSON.stringify(step.inputSchema) &&
          (step.outputSchema === null
            ? listed.outputSchema === undefined
            : JSON.stringify(listed.outputSchema) ===
              JSON.stringify(step.outputSchema)) &&
          JSON.stringify(listed.annotations) ===
            JSON.stringify(step.annotations)
        );
      });
    const outputsValid = successfulCalls.every((call) => {
      const response = call.response || {};
      const text = response.content?.[0]?.text;
      const step = workflowScenario.steps.find(
        (candidate) => candidate.tool === call.params?.name,
      );
      if (!step || typeof text !== "string") return false;
      if (step.responseMode === "text-only") {
        return response.structuredContent === undefined;
      }
      if (response.structuredContent === undefined) return false;
      try {
        return (
          JSON.stringify(JSON.parse(text)) ===
          JSON.stringify(response.structuredContent)
        );
      } catch {
        return false;
      }
    });
    checks[`${taskId}-mcp-tools-list`] = {
      passed: listedContractsValid,
      message:
        "tools/list did not expose the exact unique input/output contracts",
      actual: listedTools || [],
    };
    checks[`${taskId}-required-tools`] = {
      passed: assignment.missingStepIds.length === 0 && outputsValid,
      message: `required workflow steps were not completed: ${assignment.missingStepIds.join(", ")}`,
      actual: {
        successfulNames,
        assignedStepIds: assignment.assignedStepIds,
        outputsValid,
      },
    };
    checks[`${taskId}-tool-order`] = {
      passed:
        assignment.missingStepIds.length === 0 &&
        assignment.unmatchedSuccessfulCalls.length === 0,
      message: "required tools were not called in dependency-safe order",
      actual: {
        assignedStepIds: assignment.assignedStepIds,
        unmatchedSuccessfulCalls: assignment.unmatchedSuccessfulCalls,
        recoveredToolErrors: toolErrors.length,
      },
    };
  }
  return checks;
}

function assignWorkflowCalls(successfulCalls, scenario) {
  const completed = new Set();
  const assignedStepIds = [];
  const unmatchedSuccessfulCalls = [];
  for (const call of successfulCalls) {
    const candidates = scenario.steps.filter(
      (step) =>
        step.tool === call.params?.name &&
        !completed.has(step.stepId) &&
        step.requires.every((dependency) => completed.has(dependency)),
    );
    const step = candidates.find((candidate) => {
      const argumentsValue = applyArgumentNormalization(
        call.params?.arguments || {},
        candidate.argumentNormalization || {},
      );
      return workflowArgumentsMatch(argumentsValue, candidate);
    });
    if (!step) {
      unmatchedSuccessfulCalls.push({
        name: call.params?.name,
        arguments: call.params?.arguments || {},
      });
      continue;
    }
    completed.add(step.stepId);
    assignedStepIds.push(step.stepId);
  }
  return {
    assignedStepIds,
    unmatchedSuccessfulCalls,
    missingStepIds: scenario.steps
      .filter((step) => !completed.has(step.stepId))
      .map((step) => step.stepId),
  };
}

function applyArgumentNormalization(argumentsValue, normalization) {
  const normalized = structuredClone(argumentsValue);
  for (const [dottedPath, rule] of Object.entries(normalization)) {
    const components = dottedPath.split(".");
    let current = normalized;
    for (const component of components.slice(0, -1)) {
      if (!current || typeof current !== "object" || !(component in current)) {
        current = null;
        break;
      }
      current = current[component];
    }
    const leaf = components.at(-1);
    if (!current || typeof current !== "object" || !(leaf in current)) continue;
    const value = current[leaf];
    if (rule === "lowercase" && typeof value === "string") {
      current[leaf] = value.trim().toLowerCase();
    } else if (rule === "trim" && typeof value === "string") {
      current[leaf] = value.trim();
    }
  }
  return normalized;
}

function workflowArgumentsMatch(argumentsValue, step) {
  const assertions = step.argumentAssertions;
  if (!Array.isArray(assertions)) {
    return (
      JSON.stringify(normalizeComparable(argumentsValue)) ===
      JSON.stringify(normalizeComparable(step.expectedArguments || {}))
    );
  }
  return assertions.every((assertion) => {
    const actual = readDottedPath(argumentsValue, assertion.path);
    if (!actual.found) return false;
    if (assertion.operator === "contains-all") {
      if (typeof actual.value !== "string") return false;
      const haystack = normalizeComparable(actual.value).toLocaleLowerCase();
      return assertion.values.every((value) =>
        haystack.includes(normalizeComparable(value).toLocaleLowerCase()),
      );
    }
    const expected = readDottedPath(
      step.expectedArguments || {},
      assertion.path,
    );
    if (!expected.found) return false;
    if (assertion.operator === "normalized-equals") {
      return (
        JSON.stringify(normalizeComparable(actual.value)) ===
        JSON.stringify(normalizeComparable(expected.value))
      );
    }
    if (assertion.operator === "instant-equals") {
      const actualTime = Date.parse(actual.value);
      const expectedTime = Date.parse(expected.value);
      return Number.isFinite(actualTime) && actualTime === expectedTime;
    }
    if (assertion.operator === "set-equals") {
      if (!Array.isArray(actual.value) || !Array.isArray(expected.value)) {
        return false;
      }
      const canonical = (values) =>
        values
          .map((value) => JSON.stringify(normalizeComparable(value)))
          .sort();
      return (
        JSON.stringify(canonical(actual.value)) ===
        JSON.stringify(canonical(expected.value))
      );
    }
    return false;
  });
}

function normalizeComparable(value) {
  if (typeof value === "string") {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  }
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeComparable(child),
      ]),
    );
  }
  return value;
}

function readDottedPath(root, dottedPath) {
  let current = root;
  for (const component of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || !(component in current)) {
      return { found: false };
    }
    current = current[component];
  }
  return { found: true, value: current };
}

function runVerifier(verifier, workspace, workflow) {
  const workflowEnvironment = workflow.scenarioPath
    ? {
        MCP_WORKFLOW_SCENARIO: workflow.scenarioPath,
        MCP_WORKFLOW_STATE: workflow.statePath,
        MCP_WORKFLOW_TRACE: workflow.tracePath,
      }
    : {};
  const result = spawnSync(pythonCommand(), [verifier], {
    cwd: workspace,
    env: {
      ...process.env,
      FILESYSTEM_TEST_DIR: workspace,
      PYTHONDONTWRITEBYTECODE: "1",
      ...workflowEnvironment,
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 5 * 60_000,
  });
  return {
    verifier,
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || String(result.error || ""),
  };
}

async function probeMcpServer(launch, configuredCalls) {
  const child = spawn(launch.command, launch.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.on("exit", (code, signal) => {
    for (const waiter of pending.values()) {
      waiter.reject(
        new Error(
          `MCP self-test server exited (${code ?? signal ?? "unknown"}): ${stderr}`,
        ),
      );
    }
    pending.clear();
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out: ${stderr}`)),
        10_000,
      );
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return promise;
  };
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tura-mcp-self-test", version: "1.0.0" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );
    await request("tools/list");
    const calls = configuredCalls || [
      {
        name: "write_file",
        arguments: { path: ".mcp-self-test", content: "ok\n" },
      },
    ];
    for (const call of calls) await request("tools/call", call);
  } finally {
    child.stdin.end();
    child.kill();
  }
}

function initializeGit(workspace) {
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "benchmark@example.invalid"]);
  git(workspace, ["config", "user.name", "Tura Benchmark"]);
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-m", "MCP task baseline"]);
}

function repositorySnapshot(workspace, runDirectory) {
  return {
    repoRoot: workspace,
    gitHead: git(workspace, ["rev-parse", "HEAD"]).stdout.trim(),
    gitStatusShort: git(workspace, ["status", "--short"]).stdout,
    capturedAt: new Date().toISOString(),
    snapshotPath: path.relative(runDirectory, workspace).replaceAll("\\", "/"),
  };
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.error}`,
    );
  }
  return result;
}

function normalizedUsage(value = {}) {
  const inputTokens = Number(value.inputTokens ?? value.input_tokens ?? 0);
  const cacheInputTokens = Number(
    value.cacheInputTokens ?? value.cache_input_tokens ?? 0,
  );
  const outputTokens = Number(value.outputTokens ?? value.output_tokens ?? 0);
  return {
    inputTokens,
    cacheInputTokens,
    outputTokens,
    reasoningTokens: Number(
      value.reasoningTokens ?? value.reasoning_tokens ?? 0,
    ),
    totalTokens: Number(
      value.totalTokens ?? value.total_tokens ?? inputTokens + outputTokens,
    ),
  };
}

function pythonCommand() {
  return (
    process.env.TURA_BENCHMARK_PYTHON ||
    process.env.PYTHON ||
    (process.platform === "win32" ? "python.exe" : "python3")
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(file, value) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mkdirp(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}
