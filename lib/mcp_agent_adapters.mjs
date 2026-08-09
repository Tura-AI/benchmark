import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const VARIABLE = /\$\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function loadMcpAgentAdapters(taskDirectory) {
  const taskDir = path.resolve(taskDirectory);
  const manifestPath = path.join(taskDir, "adapters", "manifest.json");
  assert(
    fs.existsSync(manifestPath),
    `missing MCP adapter manifest: ${manifestPath}`,
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schema, "tura.benchmark.mcp-agent-adapters.v1");
  assert.equal(manifest.taskId, path.basename(taskDir));
  return { manifest, manifestPath, taskDir };
}

export function resolveMcpServerLaunch(adapter, variables) {
  const values = {
    python: variables.python,
    taskDir: path.resolve(variables.taskDir),
    workspace: path.resolve(variables.workspace),
    tracePath: path.resolve(variables.tracePath),
    scenarioPath: variables.scenarioPath
      ? path.resolve(variables.scenarioPath)
      : undefined,
    statePath: variables.statePath
      ? path.resolve(variables.statePath)
      : undefined,
  };
  return {
    name: adapter.server.name,
    transport: adapter.server.transport,
    command: expand(adapter.server.command, values),
    args: adapter.server.args.map((argument) => {
      const expanded = expand(argument, values);
      return /^\$\{(?:taskDir|workspace|tracePath|scenarioPath|statePath)\}(?:[\\/]|$)/.test(
        argument,
      )
        ? path.normalize(expanded)
        : expanded;
    }),
  };
}

export function codexMcpConfigOverrides(adapter, launch) {
  const settings = adapter.adapters.codex.settings;
  const prefix = `mcp_servers.${launch.name}`;
  return [
    `${prefix}.command=${tomlString(launch.command)}`,
    `${prefix}.args=${tomlArray(launch.args)}`,
    `${prefix}.required=${settings.required ? "true" : "false"}`,
    `${prefix}.default_tools_approval_mode=${tomlString(settings.defaultToolsApprovalMode)}`,
    `${prefix}.startup_timeout_sec=${settings.startupTimeoutSec}`,
    `${prefix}.tool_timeout_sec=${settings.toolTimeoutSec}`,
  ];
}

export function turaCommandAdapterEnvironment(adapter, launch) {
  return {
    TURA_MCP_SERVER_NAME: launch.name,
    TURA_MCP_SERVER_TRANSPORT: launch.transport,
    TURA_MCP_SERVER_COMMAND: launch.command,
    TURA_MCP_SERVER_ARGS_JSON: JSON.stringify(launch.args),
    TURA_MCP_COMMAND_ID: adapter.adapters.turaCommand.commandId,
  };
}

function expand(value, variables) {
  return String(value).replace(VARIABLE, (_, name) => {
    const replacement = variables[name];
    assert(
      replacement !== undefined && replacement !== null && replacement !== "",
      `missing MCP adapter variable: ${name}`,
    );
    return String(replacement);
  });
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(",")}]`;
}
