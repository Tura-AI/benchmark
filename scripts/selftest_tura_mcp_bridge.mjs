#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { startMcpStdioBroker } from "../lib/mcp_stdio_broker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-bridge-"));
try {
  const task = path.join(root, "tasks", "mcp", "mcp-config-precedence");
  const workspace = path.join(temporary, "workspace");
  const tracePath = path.join(temporary, "trace.jsonl");
  const server = path.join(task, "mcp_server.py");
  const bridge = path.join(
    root,
    "target",
    "debug",
    process.platform === "win32"
      ? "tura-command-mcp-stdio-bridge.exe"
      : "tura-command-mcp-stdio-bridge",
  );
  const python =
    process.env.TURA_BENCHMARK_PYTHON ||
    process.env.PYTHON ||
    (process.platform === "win32" ? "python.exe" : "python3");
  fs.cpSync(path.join(task, "fixture"), workspace, { recursive: true });
  assert(fs.existsSync(bridge), `build the Tura MCP bridge first: ${bridge}`);
  const broker = await startMcpStdioBroker({
    command: python,
    args: [server, "--workspace", workspace, "--trace", tracePath],
  });
  let writeResponse;
  let readResponse;
  try {
    writeResponse = await runBridge(
      bridge,
      {
        name: "write_file",
        arguments: { path: ".bridge-self-test", content: "ok\n" },
      },
      workspace,
      broker,
    );
    readResponse = await runBridge(
      bridge,
      {
        name: "read_file",
        arguments: { path: ".bridge-self-test" },
      },
      workspace,
      broker,
    );
  } finally {
    await broker.stop();
  }
  assert.equal(writeResponse.ok, true, JSON.stringify(writeResponse));
  assert.equal(readResponse.ok, true, JSON.stringify(readResponse));
  assert.equal(
    fs.readFileSync(path.join(workspace, ".bridge-self-test"), "utf8"),
    "ok\n",
  );
  const methods = fs
    .readFileSync(tracePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line).method);
  assert.equal(methods.filter((method) => method === "initialize").length, 1);
  assert.equal(methods.filter((method) => method === "tools/list").length, 1);
  assert.equal(methods.filter((method) => method === "tools/call").length, 2);
  process.stdout.write(
    `${JSON.stringify({ status: "pass", writeResponse, readResponse, methods })}\n`,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function runBridge(bridge, arguments_, workspace, broker) {
  const envelope = {
    kind: "execute",
    payload: {
      arguments: arguments_,
      session_dir: workspace,
      call_id: `bridge-self-test-${arguments_.name}`,
    },
  };
  return new Promise((resolve, reject) => {
    const child = spawn(bridge, ["--protocol"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        TURA_MCP_BROKER_ADDR: broker.address,
        TURA_MCP_BROKER_TOKEN: broker.token,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      try {
        assert.equal(code, 0, stderr);
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(envelope));
  });
}
