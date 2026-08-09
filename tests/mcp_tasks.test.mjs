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

const root = path.resolve(import.meta.dirname, "..");
const taskRoot = path.join(root, "tasks", "mcp");

test("all MCP tasks own their complete executable and verification artifacts", () => {
  const tasks = fs
    .readdirSync(taskRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(tasks.length, 20);
  for (const task of tasks) {
    const directory = path.join(taskRoot, task);
    for (const required of [
      "benchmark.task.json",
      "adapters/codex/config.toml",
      "adapters/manifest.json",
      "adapters/tura-command/agent-capability.json",
      "adapters/tura-command/bridge.json",
      "adapters/tura-command/command.toml",
      "adapters/tura-command/policy.toml",
      "adapters/tura-command/prompt.md",
      "adapters/tura-command/schema.json",
      "fixture",
      "harness.json",
      "mcp_server.py",
      "prompt.md",
      "runner.mjs",
      "task.json",
      "verify.py",
    ]) {
      assert.ok(
        fs.existsSync(path.join(directory, required)),
        `${task}/${required}`,
      );
    }
    const verifier = fs.readFileSync(path.join(directory, "verify.py"), "utf8");
    assert.doesNotMatch(verifier, /deepswe_verify|shared verifier/i, task);
    assert.match(verifier, /def verify_[a-z0-9_]+\(/, task);
    const contract = JSON.parse(
      fs.readFileSync(path.join(directory, "task.json"), "utf8"),
    );
    assert.equal(contract.id, task);
    assert.equal(contract.category, "mcp");
    assert.equal(contract.mcp.server, "tura_filesystem");
    assert.equal(contract.mcp.transport, "stdio");
    assert.equal(contract.mcp.entrypoint, `tasks/mcp/${task}/mcp_server.py`);
    assert.equal(contract.mcp.schemaDiscovery, "tools/list");
    assert.equal(contract.mcp.traceArtifact, "mcp/trace.jsonl");
    assert.deepEqual(contract.mcp.adapters, {
      manifest: `tasks/mcp/${task}/adapters/manifest.json`,
      codex: `tasks/mcp/${task}/adapters/codex/config.toml`,
      turaCommand: `tasks/mcp/${task}/adapters/tura-command/command.toml`,
    });

    const { manifest } = loadMcpAgentAdapters(directory);
    assert.equal(manifest.taskId, task);
    assert.deepEqual(manifest.server.tools, [
      "read_file",
      "write_file",
      "list_directory",
      "make_directory",
      "move_file",
      "delete_file",
      "search_files",
    ]);
    const turaSchema = readJson(
      path.join(directory, "adapters", "tura-command", "schema.json"),
    );
    assert.equal(turaSchema.name, "mcp_workspace");
    assert.deepEqual(
      turaSchema.input_schema.oneOf.map((entry) => entry.properties.name.const),
      manifest.server.tools,
    );
    assert.ok(
      turaSchema.input_schema.oneOf.every(
        (entry) => entry.properties.arguments.type === "object",
      ),
    );
    const bridge = readJson(
      path.join(directory, "adapters", "tura-command", "bridge.json"),
    );
    assert.deepEqual(bridge.connectionLifecycle, {
      scope: "benchmark-attempt",
      broker: "lib/mcp_stdio_broker.mjs",
      lazyInitialize: true,
      authentication: "ephemeral-random-token",
    });
  }
});

test("Codex and Tura adapters resolve the same task-local stdio server", () => {
  const directory = path.join(taskRoot, "mcp-config-precedence");
  const { manifest } = loadMcpAgentAdapters(directory);
  const launch = resolveMcpServerLaunch(manifest, {
    python: "python-test",
    taskDir: directory,
    workspace: path.join(directory, "fixture"),
    tracePath: path.join(directory, "trace-test.jsonl"),
  });
  assert.equal(launch.command, "python-test");
  assert.equal(launch.args[0], path.join(directory, "mcp_server.py"));
  assert.deepEqual(codexMcpConfigOverrides(manifest, launch).slice(0, 2), [
    'mcp_servers.tura_filesystem.command="python-test"',
    `mcp_servers.tura_filesystem.args=[${launch.args
      .map((value) => JSON.stringify(value))
      .join(",")}]`,
  ]);
  const turaEnvironment = turaCommandAdapterEnvironment(manifest, launch);
  assert.equal(turaEnvironment.TURA_MCP_SERVER_COMMAND, "python-test");
  assert.deepEqual(
    JSON.parse(turaEnvironment.TURA_MCP_SERVER_ARGS_JSON),
    launch.args,
  );
});

test("an MCP task performs a real stdio handshake and writes schema-shaped reports", () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-task-test-"));
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(taskRoot, "mcp-config-precedence", "runner.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          COMMAND_RUN_AGENT_RUN_ID: "mcp-config-precedence-test",
          TURA_BENCHMARK_RUN_DIRECTORY: output,
          TURA_MCP_SELF_TEST: "1",
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    const trace = fs
      .readFileSync(path.join(output, "mcp", "trace.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      trace.filter((row) => row.id !== null).map((row) => row.method),
      ["initialize", "tools/list", "tools/call"],
    );
    const listedTools = trace.find((row) => row.method === "tools/list")
      .response.tools;
    assert.ok(listedTools.length >= 7);
    assert.ok(listedTools.every((tool) => tool.inputSchema?.type === "object"));

    const contracts = path.join(output, "metadata", "contracts");
    const taskReport = readJson(path.join(contracts, "task-report.json"));
    const harnessReport = readJson(path.join(contracts, "harness-report.json"));
    const resultEnvelope = readJson(path.join(output, "result.json"));
    assert.equal(taskReport.schema, "tura.benchmark.task-report.v1");
    assert.equal(taskReport.category, "mcp");
    assert.equal(taskReport.mcp.initialized, true);
    assert.equal(taskReport.mcp.schemaListed, true);
    assert.equal(harnessReport.schema, "tura.benchmark.harness-report.v2");
    assert.equal(harnessReport.results.length, 4);
    assert.equal(harnessReport.score.passed, 3);
    assert.equal(resultEnvelope.schema_version, "2.0.0");
    assert.equal(resultEnvelope.status, "fail");
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("the task-local MCP server hides benchmark runtime state", () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-state-test-"));
  const workspace = path.join(output, "workspace");
  const trace = path.join(output, "trace.jsonl");
  fs.mkdirSync(path.join(workspace, ".tura"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, ".tura", "runtime-secret.txt"),
    "secret",
  );
  fs.writeFileSync(path.join(workspace, "visible.txt"), "visible");
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_directory", arguments: { path: "." } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "search_files",
        arguments: { path: ".", query: "secret" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: { path: ".tura/runtime-secret.txt" },
      },
    },
  ];
  try {
    const result = spawnSync(
      process.env.TURA_BENCHMARK_PYTHON || "python",
      [
        path.join(taskRoot, "mcp-config-precedence", "mcp_server.py"),
        "--workspace",
        workspace,
        "--trace",
        trace,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line).result);
    const listed = JSON.parse(responses[0].content[0].text);
    assert.deepEqual(listed, [{ name: "visible.txt", type: "file" }]);
    assert.deepEqual(JSON.parse(responses[1].content[0].text), []);
    assert.equal(responses[2].isError, true);
    assert.match(responses[2].content[0].text, /reserved/);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
