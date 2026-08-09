#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const taskRoot = path.join(root, "tasks", "mcp");
const python =
  process.env.TURA_BENCHMARK_PYTHON ||
  process.env.PYTHON ||
  (process.platform === "win32" ? "python.exe" : "python3");

const taskDirectories = fs
  .readdirSync(taskRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(taskRoot, entry.name))
  .sort();

assert.equal(
  taskDirectories.length,
  20,
  "expected exactly 20 selected MCP tasks",
);

for (const taskDir of taskDirectories) {
  await generateTaskAdapters(taskDir);
  await formatGeneratedAdapters(taskDir);
}
process.stdout.write(
  `generated Codex and Tura Command adapters for ${taskDirectories.length} MCP tasks\n`,
);

async function generateTaskAdapters(taskDir) {
  const taskPath = path.join(taskDir, "task.json");
  const task = readJson(taskPath);
  const serverPath = path.join(taskDir, "mcp_server.py");
  const tools = await discoverTools(serverPath, path.join(taskDir, "fixture"));
  const relativeServer = path
    .relative(taskDir, serverPath)
    .replaceAll("\\", "/");
  const adapterRoot = path.join(taskDir, "adapters");
  const codexDirectory = path.join(adapterRoot, "codex");
  const turaDirectory = path.join(adapterRoot, "tura-command");
  fs.mkdirSync(codexDirectory, { recursive: true });
  fs.mkdirSync(turaDirectory, { recursive: true });

  const server = {
    name: task.mcp.server,
    transport: "stdio",
    command: "${python}",
    args: [
      `\${taskDir}/${relativeServer}`,
      "--workspace",
      "${workspace}",
      "--trace",
      "${tracePath}",
    ],
    schemaDiscovery: "tools/list",
    tools: tools.map((tool) => tool.name),
  };
  const manifest = {
    schema: "tura.benchmark.mcp-agent-adapters.v1",
    taskId: task.id,
    server,
    adapters: {
      codex: {
        format: "codex.mcp-stdio.toml.v1",
        configTemplate: "adapters/codex/config.toml",
        settings: {
          required: true,
          defaultToolsApprovalMode: "approve",
          startupTimeoutSec: 30,
          toolTimeoutSec: 120,
        },
      },
      turaCommand: {
        format: "tura.external-command.v1",
        commandId: "mcp_workspace",
        packageDirectory: "adapters/tura-command",
        bridgeDescriptor: "adapters/tura-command/bridge.json",
        agentCapability: { capability_name: "mcp_workspace" },
      },
    },
  };
  writeJson(path.join(adapterRoot, "manifest.json"), manifest);
  fs.writeFileSync(
    path.join(codexDirectory, "config.toml"),
    codexToml(server),
    "utf8",
  );
  fs.writeFileSync(
    path.join(turaDirectory, "command.toml"),
    turaCommandToml(),
    "utf8",
  );
  writeJson(path.join(turaDirectory, "schema.json"), turaCommandSchema(tools));
  fs.writeFileSync(
    path.join(turaDirectory, "prompt.md"),
    turaPrompt(tools),
    "utf8",
  );
  fs.writeFileSync(
    path.join(turaDirectory, "policy.toml"),
    "read_only = false\nnetwork = false\n",
    "utf8",
  );
  writeJson(
    path.join(turaDirectory, "bridge.json"),
    turaBridge(task.id, server),
  );
  writeJson(path.join(turaDirectory, "agent-capability.json"), {
    capability_name: "mcp_workspace",
  });
  fs.writeFileSync(
    path.join(adapterRoot, "README.md"),
    adapterReadme(task.id),
    "utf8",
  );

  task.mcp.adapters = {
    manifest: `tasks/mcp/${task.id}/adapters/manifest.json`,
    codex: `tasks/mcp/${task.id}/adapters/codex/config.toml`,
    turaCommand: `tasks/mcp/${task.id}/adapters/tura-command/command.toml`,
  };
  writeJson(taskPath, task);
}

function codexToml(server) {
  return `[mcp_servers.${server.name}]\ncommand = "\${python}"\nargs = ["\${taskDir}/mcp_server.py", "--workspace", "\${workspace}", "--trace", "\${tracePath}"]\nrequired = true\ndefault_tools_approval_mode = "approve"\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n`;
}

function turaCommandToml() {
  return `id = "mcp_workspace"\nname = "MCP Workspace"\ndescription = "Call one tool exposed by the task-local filesystem MCP server."\ncore = false\ncategory = "mcp"\nexecution = "one_shot"\nstate_machine = "default_command"\nsupports_macro_command = true\nmutating = true\nnetwork = false\n\n[runtime]\nbinary = "tura-command-mcp-stdio-bridge"\nentry = ""\nlanguage = "rust"\n\n[limits]\ndefault_timeout_ms = 120000\nmax_timeout_ms = 300000\n\n[paths]\nprompt = "prompt.md"\nschema = "schema.json"\npolicy = "policy.toml"\n`;
}

function turaCommandSchema(tools) {
  return {
    name: "mcp_workspace",
    description:
      "Dispatch one schema-validated tools/call request to the task-local filesystem MCP server.",
    input_schema: {
      oneOf: tools.map((tool) => ({
        title: tool.name,
        type: "object",
        required: ["name", "arguments"],
        additionalProperties: false,
        properties: {
          name: { const: tool.name, description: tool.description },
          arguments: tool.inputSchema,
        },
      })),
    },
  };
}

function turaPrompt(tools) {
  const rows = tools
    .map((tool) => `- \`${tool.name}\`: ${tool.description}`)
    .join("\n");
  return `Use \`mcp_workspace\` for every workspace read, search, list, and mutation in this task.\n\nPass MCP \`tools/call\` parameters unchanged as JSON:\n\n\`\`\`json\n{"name":"read_file","arguments":{"path":"src/example.py"}}\n\`\`\`\n\nAvailable task-local MCP tools:\n\n${rows}\n\nDo not use shell or built-in file-edit commands for task workspace operations.\n`;
}

function turaBridge(taskId, server) {
  return {
    schema: "tura.benchmark.tura-command-mcp-bridge.v1",
    taskId,
    commandId: "mcp_workspace",
    runtimeBinary: "tura-command-mcp-stdio-bridge",
    runtimeSource: "tools/tura-command-mcp-stdio-bridge",
    buildCommand: "npm run mcp:tura-bridge:build",
    connectionLifecycle: {
      scope: "benchmark-attempt",
      broker: "lib/mcp_stdio_broker.mjs",
      lazyInitialize: true,
      authentication: "ephemeral-random-token",
    },
    externalProtocol: {
      invocation: ["${runtimeBinary}", "--protocol"],
      request: {
        kind: "execute",
        argumentsPath: "payload.arguments",
        workspacePath: "payload.session_dir",
        callIdPath: "payload.call_id",
      },
      response: {
        required: ["ok", "success", "output", "stderr", "exit_code"],
      },
    },
    mcpServer: server,
    mapping: {
      "payload.arguments.name": "tools/call.params.name",
      "payload.arguments.arguments": "tools/call.params.arguments",
      "payload.session_dir": "server.args.${workspace}",
    },
    requiredHandshake: [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ],
  };
}

function adapterReadme(taskId) {
  return `# Agent adapters for ${taskId}\n\n- \`manifest.json\` is the single normalized stdio server definition.\n- \`codex/config.toml\` is the Codex CLI MCP configuration template.\n- \`tura-command/\` is a Tura external-command package. Its command line is the native MCP \`tools/call\` object: \`{\"name\": ..., \"arguments\": ...}\`.\n- The Tura package uses the shared \`tools/tura-command-mcp-stdio-bridge\` runtime to translate Tura's one-shot external-command envelope into a run-scoped, token-authenticated broker. The broker lazily initializes one stdio MCP server per benchmark attempt and reuses it for every tool call. Build the bridge with \`npm run mcp:tura-bridge:build\`.\n\nTemplate variables are resolved per run: \`python\`, \`taskDir\`, \`workspace\`, and \`tracePath\`.\n`;
}

async function discoverTools(server, workspace) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tura-mcp-adapter-"));
  const trace = path.join(temporary, "trace.jsonl");
  const child = spawn(
    python,
    [server, "--workspace", workspace, "--trace", trace],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let buffer = "";
  let stderr = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  let nextId = 1;
  const request = (method, params = {}) => {
    const id = nextId++;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out: ${stderr}`)),
        10_000,
      );
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
    });
  };
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tura-adapter-generator", version: "1.0.0" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );
    const result = await request("tools/list");
    assert(
      Array.isArray(result.tools) && result.tools.length > 0,
      `${server} exposed no tools`,
    );
    return result.tools;
  } finally {
    child.stdin.end();
    child.kill();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function formatGeneratedAdapters(taskDir) {
  const adapterRoot = path.join(taskDir, "adapters");
  const files = walk(adapterRoot).filter((file) => /\.(?:json|md)$/.test(file));
  files.push(path.join(taskDir, "task.json"));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, await format(source, { filepath: file }), "utf8");
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
