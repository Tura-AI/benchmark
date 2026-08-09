import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  callMcpStdioBroker,
  startMcpStdioBroker,
} from "../lib/mcp_stdio_broker.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("the run-scoped broker reuses one MCP initialization across tool calls", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-broker-"));
  const workspace = path.join(directory, "workspace");
  const tracePath = path.join(directory, "trace.jsonl");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "one.txt"), "one", "utf8");
  const broker = await startMcpStdioBroker({
    command: process.env.TURA_BENCHMARK_PYTHON || "python",
    args: [
      path.join(root, "tasks", "mcp", "mcp-config-precedence", "mcp_server.py"),
      "--workspace",
      workspace,
      "--trace",
      tracePath,
    ],
  });
  try {
    assert.equal(
      fs.existsSync(tracePath),
      false,
      "broker must initialize lazily",
    );
    const read = await callMcpStdioBroker(
      broker.address,
      broker.token,
      "read_file",
      { path: "one.txt" },
    );
    assert.equal(read.content[0].text, "one");
    const listed = await callMcpStdioBroker(
      broker.address,
      broker.token,
      "list_directory",
      { path: "." },
    );
    assert.deepEqual(JSON.parse(listed.content[0].text), [
      { name: "one.txt", type: "file" },
    ]);
    await assert.rejects(
      callMcpStdioBroker(broker.address, "wrong-token", "read_file", {
        path: "one.txt",
      }),
      /invalid MCP broker token/,
    );
  } finally {
    await broker.stop();
  }

  const methods = fs
    .readFileSync(tracePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line).method);
  assert.equal(methods.filter((method) => method === "initialize").length, 1);
  assert.equal(methods.filter((method) => method === "tools/list").length, 1);
  assert.equal(methods.filter((method) => method === "tools/call").length, 2);
});
