import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  codexMcpConfigOverrides,
  loadMcpAgentAdapters,
  resolveMcpServerLaunch,
  turaCommandAdapterEnvironment,
} from "../lib/mcp_agent_adapters.mjs";
import { evaluateChecks } from "../lib/mcp_task_runner.mjs";

const root = path.resolve(import.meta.dirname, "..");
const taskRoot = path.join(root, "tasks", "mcp_workflow");
const tasks = fs
  .readdirSync(taskRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("the MCP workflow collection contains ten independent deterministic tasks", () => {
  assert.deepEqual(tasks, [
    "workflow-campaign-image-email",
    "workflow-contract-signature",
    "workflow-customer-onboarding",
    "workflow-ecommerce-ad-package",
    "workflow-event-promo-kit",
    "workflow-incident-response",
    "workflow-invoice-email-followup",
    "workflow-product-demo-video",
    "workflow-recruiting-interview-pack",
    "workflow-social-thumbnail-approval",
  ]);
  const allServices = new Set();
  for (const taskId of tasks) {
    const directory = path.join(taskRoot, taskId);
    for (const required of [
      "adapters/codex/config.toml",
      "adapters/manifest.json",
      "adapters/tura-command/agent-capability.json",
      "adapters/tura-command/bridge.json",
      "adapters/tura-command/command.toml",
      "adapters/tura-command/policy.toml",
      "adapters/tura-command/prompt.md",
      "adapters/tura-command/schema.json",
      "benchmark.task.json",
      "fixture/README.md",
      "harness.json",
      "mcp_server.py",
      "prompt.md",
      "runner.mjs",
      "scenario.json",
      "task.json",
      "verify.py",
    ]) {
      assert.ok(
        fs.existsSync(path.join(directory, required)),
        `${taskId}/${required}`,
      );
    }
    const scenario = readJson(path.join(directory, "scenario.json"));
    assert.equal(scenario.id, taskId);
    assert.deepEqual(scenario.evaluation, {
      mode: "deterministic-script",
      llmJudge: false,
      humanReview: false,
      checks: [
        "critical-argument-assertions",
        "dependency-order",
        "recovered-tool-errors-allowed",
        "exact-final-state",
      ],
    });
    assert.ok(scenario.steps.length >= 4, taskId);
    assert.equal(scenario.schema, "tura.benchmark.mcp-workflow-scenario.v2");
    for (const step of scenario.steps) {
      assert.ok(step.stepId);
      assert.ok(step.argumentAssertions.length > 0, step.stepId);
      if (step.responseMode === "text-only") {
        assert.equal(step.outputSchema, null);
        assert.equal(typeof step.result, "string");
      } else {
        assert.ok(step.outputSchema);
      }
      assert.ok(step.annotations);
      assert.ok(
        ["official-mcp", "vendor-api-adapter"].includes(step.contract.fidelity),
      );
      assert.match(step.contract.source, /^https:\/\//);
    }
    assert.deepEqual(
      scenario.selfTest.calls,
      scenario.steps.map((step) => ({
        name: step.tool,
        arguments: step.expectedArguments,
      })),
    );
    const draftStep = scenario.steps.find(
      (step) => step.effects.append?.["gmail.drafts"],
    );
    if (scenario.expectedState["gmail.lastDraft"]) {
      assert.ok(draftStep, `${taskId} must append Gmail drafts`);
      assert.deepEqual(scenario.expectedState["gmail.drafts"], [
        draftStep.effects.append["gmail.drafts"],
      ]);
    }
    const replyStep = scenario.steps.find(
      (step) => step.effects.append?.["gmail.replyDrafts"],
    );
    if (scenario.expectedState["gmail.lastReplyDraft"]) {
      assert.ok(replyStep, `${taskId} must append Gmail reply drafts`);
      assert.deepEqual(scenario.expectedState["gmail.replyDrafts"], [
        replyStep.effects.append["gmail.replyDrafts"],
      ]);
    }
    const position = new Map(
      scenario.steps.map((step, index) => [step.stepId, index]),
    );
    for (const [index, step] of scenario.steps.entries()) {
      assert.ok(
        step.requires.every((dependency) => position.get(dependency) < index),
        `${taskId}/${step.stepId} must only depend on prior steps`,
      );
    }
    for (const service of scenario.services) allServices.add(service);

    const prompt = fs.readFileSync(path.join(directory, "prompt.md"), "utf8");
    assert.doesNotMatch(
      prompt,
      /redesign|reimagine|make it (?:look )?(?:better|beautiful)|visually appealing|creative freedom|human review|llm judge/i,
      taskId,
    );
    const task = readJson(path.join(directory, "task.json"));
    assert.equal(task.category, "mcp");
    assert.equal(task.mcp.mode, "stateful-workflow");
    assert.equal(task.methodology.scoring, "deterministic-script-only");
    assert.equal(task.methodology.llmJudge, false);
    assert.equal(task.methodology.humanReview, false);
    const harness = readJson(path.join(directory, "harness.json"));
    assert.equal(harness.scoreItemCount, 5);
    assert.equal(harness.scoreItems.length, 5);
    assert.deepEqual(
      harness.scoreItems.map((item) => item.id),
      [
        `${taskId}-mcp-initialize`,
        `${taskId}-mcp-tools-list`,
        `${taskId}-required-tools`,
        `${taskId}-tool-order`,
        `${taskId}-task-behavior`,
      ],
    );
    const { manifest } = loadMcpAgentAdapters(directory);
    assert.deepEqual(manifest.server.tools, [
      ...new Set(scenario.steps.map((step) => step.tool)),
    ]);
    const schema = readJson(
      path.join(directory, "adapters", "tura-command", "schema.json"),
    );
    assert.deepEqual(
      schema.input_schema.oneOf.map((entry) => entry.properties.name.const),
      manifest.server.tools,
    );
  }
  assert.ok(allServices.has("Adobe Photoshop"));
  assert.ok(allServices.has("Adobe Premiere Pro"));
  assert.ok(allServices.has("Gmail"));
  const contract = readJson(
    path.join(taskRoot, "workflow-contract-signature", "scenario.json"),
  );
  assert.deepEqual(contract.steps.at(-1).requires, []);
  const ecommerce = readJson(
    path.join(taskRoot, "workflow-ecommerce-ad-package", "scenario.json"),
  );
  assert.deepEqual(ecommerce.steps[6].requires, ["step-01"]);
  const recruiting = readJson(
    path.join(taskRoot, "workflow-recruiting-interview-pack", "scenario.json"),
  );
  assert.deepEqual(recruiting.steps[1].requires, ["step-01"]);
  assert.deepEqual(recruiting.steps[2].requires, ["step-01"]);
  const generatedTools = new Set(
    tasks.flatMap((taskId) =>
      readJson(path.join(taskRoot, taskId, "scenario.json")).steps.map(
        (step) => step.tool,
      ),
    ),
  );
  for (const officialName of [
    "create_draft",
    "create_event",
    "create_file",
    "create-design-from-candidate",
    "create_invoice",
    "create_invoice_item",
    "download_assets",
    "download_file_content",
    "export-design",
    "generate-design",
    "get_event",
    "get_issue_details",
    "get_metadata",
    "get_thread",
    "issue_write",
    "search_files",
    "search_threads",
    "send_message",
    "finalize_invoice",
  ]) {
    assert.ok(generatedTools.has(officialName), officialName);
  }
  for (const removedLegacyName of [
    "gmail_send_email",
    "gmail_reply_email",
    "drive_search_files",
    "stripe_create_invoice",
    "figma_get_file",
    "stripe_api_write",
    "sentry_get_issue",
  ]) {
    assert.ok(!generatedTools.has(removedLegacyName), removedLegacyName);
  }
  const generator = fs.readFileSync(
    path.join(root, "scripts", "generate_mcp_workflow_tasks.mjs"),
    "utf8",
  );
  assert.doesNotMatch(generator, /schemaFromExample/);

  for (const taskId of tasks) {
    const scenario = readJson(path.join(taskRoot, taskId, "scenario.json"));
    for (const step of scenario.steps) {
      if (step.tool === "search_files") {
        assert.match(step.expectedArguments.query, /^title contains '/);
        assert.doesNotMatch(step.expectedArguments.query, /^name contains '/);
      }
      if (step.tool === "create_draft") {
        assert.ok(!("attachments" in step.expectedArguments));
        assert.match(step.result.date, /^\d{4}-\d{2}-\d{2}$/);
      }
      if (step.tool === "get_issue_details") {
        assert.deepEqual(step.expectedArguments, {
          organizationSlug: "acme",
          issueId: "SENTRY-PAY-500",
        });
        assert.equal(step.contract.fidelity, "official-mcp");
        assert.equal(step.responseMode, "text-only");
        assert.equal(step.outputSchema, null);
      }
    }
  }
});

test("Codex and Tura resolve the same workflow server, scenario, and state", () => {
  const directory = path.join(taskRoot, "workflow-campaign-image-email");
  const { manifest } = loadMcpAgentAdapters(directory);
  const workspace = path.join(directory, "fixture");
  const tracePath = path.join(directory, "trace-test.jsonl");
  const scenarioPath = path.join(directory, "scenario.json");
  const statePath = path.join(directory, "state-test.json");
  const launch = resolveMcpServerLaunch(manifest, {
    python: "python-test",
    taskDir: directory,
    workspace,
    tracePath,
    scenarioPath,
    statePath,
  });
  assert.equal(launch.command, "python-test");
  assert.deepEqual(launch.args.slice(-4), [
    "--scenario",
    scenarioPath,
    "--state",
    statePath,
  ]);
  assert.match(codexMcpConfigOverrides(manifest, launch)[1], /--scenario/);
  const environment = turaCommandAdapterEnvironment(manifest, launch);
  assert.deepEqual(
    JSON.parse(environment.TURA_MCP_SERVER_ARGS_JSON),
    launch.args,
  );
});

test("a workflow runner emits a passing five-item code-scored report", () => {
  const output = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-mcp-workflow-test-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(taskRoot, "workflow-product-demo-video", "runner.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          COMMAND_RUN_AGENT_RUN_ID: "workflow-product-demo-video-test",
          TURA_BENCHMARK_RUN_DIRECTORY: output,
          TURA_MCP_SELF_TEST: "1",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const harness = readJson(
      path.join(output, "metadata", "contracts", "harness-report.json"),
    );
    const taskReport = readJson(
      path.join(output, "metadata", "contracts", "task-report.json"),
    );
    const state = readJson(path.join(output, "mcp", "state.json"));
    assert.equal(harness.status, "pass");
    assert.equal(harness.score.label, "5/5");
    assert.ok(harness.results.every((item) => item.passed));
    assert.equal(
      taskReport.mcp.server,
      "tura_mock_workflow_product_demo_video",
    );
    assert.deepEqual(taskReport.mcp.services, [
      "Google Drive",
      "Adobe Premiere Pro",
      "Gmail",
    ]);
    assert.equal(taskReport.mcp.toolCallCount, 7);
    assert.equal(state.artifacts.reviewVideo.durationSeconds, 60);
    assert.equal(state.gmail.lastDraft.status, "draft");
    assert.deepEqual(state.gmail.drafts, [state.gmail.lastDraft]);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("a workflow runner accepts an official text-only MCP tool response", () => {
  const output = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-mcp-workflow-text-test-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(taskRoot, "workflow-incident-response", "runner.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          COMMAND_RUN_AGENT_RUN_ID: "workflow-incident-response-test",
          TURA_BENCHMARK_RUN_DIRECTORY: output,
          TURA_MCP_SELF_TEST: "1",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const harness = readJson(
      path.join(output, "metadata", "contracts", "harness-report.json"),
    );
    const taskReport = readJson(
      path.join(output, "metadata", "contracts", "task-report.json"),
    );
    const trace = fs
      .readFileSync(path.join(output, "mcp", "trace.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const sentryCall = trace.find(
      (row) =>
        row.method === "tools/call" && row.params?.name === "get_issue_details",
    );
    assert.equal(harness.status, "pass");
    assert.equal(harness.score.label, "5/5");
    assert.equal(taskReport.mcp.schemaListed, true);
    assert.equal(typeof sentryCall.response.content[0].text, "string");
    assert.ok(!("structuredContent" in sentryCall.response));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("controlled workflow enums normalize harmless case and reject wrong values", () => {
  const directory = path.join(taskRoot, "workflow-campaign-image-email");
  const scenario = readJson(path.join(directory, "scenario.json"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-normalize-"));
  const workspace = path.join(output, "workspace");
  const trace = path.join(output, "trace.jsonl");
  const state = path.join(output, "state.json");
  fs.mkdirSync(workspace, { recursive: true });
  const calls = structuredClone(scenario.selfTest.calls);
  calls.find(
    (call) => call.name === "photoshop_export_image",
  ).arguments.format = "PNG";
  const result = runWorkflowServer(directory, workspace, trace, state, calls);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.responses.every((response) => !response.result?.isError));
  const normalizedState = readJson(state);
  assert.equal(
    normalizedState.calls.find((call) => call.tool === "photoshop_export_image")
      .arguments.format,
    "png",
  );
  const verifier = spawnSync(
    process.env.TURA_BENCHMARK_PYTHON || "python",
    [path.join(directory, "verify.py")],
    {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        MCP_WORKFLOW_SCENARIO: path.join(directory, "scenario.json"),
        MCP_WORKFLOW_STATE: state,
        MCP_WORKFLOW_TRACE: trace,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  assert.equal(verifier.status, 0, verifier.stderr);

  const invalidOutput = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-mcp-invalid-enum-"),
  );
  const invalidCalls = structuredClone(scenario.selfTest.calls);
  invalidCalls.find(
    (call) => call.name === "photoshop_export_image",
  ).arguments.format = "jpeg";
  const invalid = runWorkflowServer(
    directory,
    path.join(invalidOutput, "workspace"),
    path.join(invalidOutput, "trace.jsonl"),
    path.join(invalidOutput, "state.json"),
    invalidCalls,
  );
  const exportResponse = invalid.responses.find(
    (response) =>
      response.id ===
      3 +
        invalidCalls.findIndex(
          (call) => call.name === "photoshop_export_image",
        ),
  );
  assert.equal(exportResponse.result.isError, true);
  assert.match(exportResponse.result.content[0].text, /must be one of.*png/i);

  const invalidUriOutput = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-mcp-invalid-asset-uri-"),
  );
  const invalidUriCalls = structuredClone(scenario.selfTest.calls);
  invalidUriCalls.find(
    (call) => call.name === "photoshop_open_document",
  ).arguments.asset_uri = "gdrive://image-001";
  const invalidUri = runWorkflowServer(
    directory,
    path.join(invalidUriOutput, "workspace"),
    path.join(invalidUriOutput, "trace.jsonl"),
    path.join(invalidUriOutput, "state.json"),
    invalidUriCalls,
  );
  const openResponse = invalidUri.responses.find(
    (response) =>
      response.id ===
      3 +
        invalidUriCalls.findIndex(
          (call) => call.name === "photoshop_open_document",
        ),
  );
  assert.equal(openResponse.result.isError, true);
  assert.match(
    openResponse.result.content[0].text,
    /must match JSON Schema pattern/i,
  );
});

test("workflow matching tolerates harmless formats but keeps critical fields strict", () => {
  const cases = [
    {
      taskId: "workflow-event-promo-kit",
      mutate(calls) {
        calls.find((call) => call.name === "generate-design").arguments.query =
          "Create an Instagram post for AI Builders Lab on September 18, 18:00";
      },
    },
    {
      taskId: "workflow-contract-signature",
      mutate(calls) {
        const event = calls.find((call) => call.name === "create_event");
        event.arguments.startTime = "2026-09-25T07:00:00Z";
        event.arguments.endTime = "2026-09-25T09:30:00+02:00";
      },
    },
    {
      taskId: "workflow-recruiting-interview-pack",
      mutate(calls) {
        const document = calls.find((call) => call.name === "create_file");
        delete document.arguments.contentMimeType;
      },
    },
  ];
  for (const { taskId, mutate } of cases) {
    const directory = path.join(taskRoot, taskId);
    const scenario = readJson(path.join(directory, "scenario.json"));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-tolerant-"));
    const calls = structuredClone(scenario.selfTest.calls);
    mutate(calls);
    const result = runWorkflowServer(
      directory,
      path.join(output, "workspace"),
      path.join(output, "trace.jsonl"),
      path.join(output, "state.json"),
      calls,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.responses.every((response) => !response.result?.isError),
      taskId,
    );
    const verifier = runWorkflowVerifier(directory, output);
    assert.equal(verifier.status, 0, `${taskId}: ${verifier.stderr}`);
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("a corrected MCP call is recoverable and never commits the wrong arguments", () => {
  const taskId = "workflow-customer-onboarding";
  const directory = path.join(taskRoot, taskId);
  const scenario = readJson(path.join(directory, "scenario.json"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-recovery-"));
  try {
    const calls = structuredClone(scenario.selfTest.calls);
    const wrongDocument = structuredClone(calls[1]);
    wrongDocument.arguments.title = "new-hire-onboarding-pack";
    calls.splice(1, 0, wrongDocument);
    const tracePath = path.join(output, "trace.jsonl");
    const statePath = path.join(output, "state.json");
    const result = runWorkflowServer(
      directory,
      path.join(output, "workspace"),
      tracePath,
      statePath,
      calls,
    );
    const failedCalls = result.responses.filter(
      (response) => response.result?.isError,
    );
    assert.equal(failedCalls.length, 1);
    assert.match(
      failedCalls[0].result.content[0].text,
      /rejected before state mutation.*arguments\.title/i,
    );
    const state = readJson(statePath);
    assert.equal(state.calls.length, scenario.steps.length);
    assert.ok(
      state.calls.every(
        (call) => call.arguments.title !== "new-hire-onboarding-pack",
      ),
    );
    const verifier = runWorkflowVerifier(directory, output);
    assert.equal(verifier.status, 0, verifier.stderr);
    const trace = fs
      .readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const checks = evaluateChecks(
      trace,
      verifier,
      readJson(path.join(directory, "task.json")),
      scenario,
    );
    assert.equal(checks[`${taskId}-required-tools`].passed, true);
    assert.equal(checks[`${taskId}-tool-order`].passed, true);
    assert.equal(checks[`${taskId}-tool-order`].actual.recoveredToolErrors, 1);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("every workflow step rejects bad critical input immediately without mutation", () => {
  for (const taskId of tasks) {
    const directory = path.join(taskRoot, taskId);
    const scenario = readJson(path.join(directory, "scenario.json"));
    for (const [index, step] of scenario.steps.entries()) {
      const output = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-reject-"));
      try {
        const calls = structuredClone(
          scenario.selfTest.calls.slice(0, index + 1),
        );
        const assertion = step.argumentAssertions[0];
        mutateCriticalArgument(calls.at(-1).arguments, assertion);
        const statePath = path.join(output, "state.json");
        const result = runWorkflowServer(
          directory,
          path.join(output, "workspace"),
          path.join(output, "trace.jsonl"),
          statePath,
          calls,
        );
        const response = result.responses.find((item) => item.id === index + 3);
        assert.equal(
          response.result.isError,
          true,
          `${taskId}/${step.stepId} accepted bad ${assertion.path}`,
        );
        assert.match(
          response.result.content[0].text,
          new RegExp(`arguments\\.${escapeRegex(assertion.path)}`, "i"),
          `${taskId}/${step.stepId} did not identify the bad field`,
        );
        assert.equal(
          readJson(statePath).calls.length,
          index,
          `${taskId}/${step.stepId} mutated state after rejection`,
        );
      } finally {
        fs.rmSync(output, { recursive: true, force: true });
      }
    }
  }
});

function mutateCriticalArgument(argumentsValue, assertion) {
  if (assertion.operator === "instant-equals") {
    setDottedPath(argumentsValue, assertion.path, "2099-01-01T00:00:00Z");
    return;
  }
  if (assertion.operator === "set-equals") {
    setDottedPath(argumentsValue, assertion.path, []);
    return;
  }
  if (assertion.operator === "contains-all") {
    setDottedPath(argumentsValue, assertion.path, "unrelated request");
    return;
  }
  const current = readDottedPath(argumentsValue, assertion.path);
  if (typeof current === "string") {
    setDottedPath(argumentsValue, assertion.path, `${current}__wrong`);
  } else if (typeof current === "number") {
    setDottedPath(argumentsValue, assertion.path, current + 1);
  } else if (typeof current === "boolean") {
    setDottedPath(argumentsValue, assertion.path, !current);
  } else if (Array.isArray(current)) {
    setDottedPath(argumentsValue, assertion.path, []);
  } else {
    setDottedPath(argumentsValue, assertion.path, { wrong: true });
  }
}

function readDottedPath(rootValue, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((current, component) => current[component], rootValue);
}

function setDottedPath(rootValue, dottedPath, value) {
  const components = dottedPath.split(".");
  const leaf = components.pop();
  const parent = components.reduce(
    (current, component) => current[component],
    rootValue,
  );
  parent[leaf] = value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runWorkflowVerifier(directory, output) {
  return spawnSync(
    process.env.TURA_BENCHMARK_PYTHON || "python",
    [path.join(directory, "verify.py")],
    {
      cwd: path.join(output, "workspace"),
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        MCP_WORKFLOW_SCENARIO: path.join(directory, "scenario.json"),
        MCP_WORKFLOW_STATE: path.join(output, "state.json"),
        MCP_WORKFLOW_TRACE: path.join(output, "trace.jsonl"),
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
}

function runWorkflowServer(directory, workspace, trace, state, calls) {
  fs.mkdirSync(workspace, { recursive: true });
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "normalization-test", version: "1.0.0" },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ...calls.map((call, index) => ({
      jsonrpc: "2.0",
      id: index + 3,
      method: "tools/call",
      params: call,
    })),
  ];
  const processResult = spawnSync(
    process.env.TURA_BENCHMARK_PYTHON || "python",
    [
      path.join(directory, "mcp_server.py"),
      "--workspace",
      workspace,
      "--trace",
      trace,
      "--scenario",
      path.join(directory, "scenario.json"),
      "--state",
      state,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
    },
  );
  return {
    ...processResult,
    responses: processResult.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
