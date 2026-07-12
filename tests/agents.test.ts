import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BENCHMARK_AGENTS,
  normalizeBenchmarkAgentId,
  readAgentCliConfig,
  resolveBenchmarkAgentCli,
  resolveBenchmarkAgentMatrix,
} from "../src/agents.js";

test("agent cli config declares the required five-agent benchmark matrix", async () => {
  const config = await readAgentCliConfig();

  assert.deepEqual(config.defaultAgents, [...DEFAULT_BENCHMARK_AGENTS]);
  assert.deepEqual(
    config.agents.map((agent) => agent.id),
    ["pi", "codex-cli", "claudecode", "opencode", "tura"],
  );
});

test("agent aliases normalize to canonical ids", async () => {
  const config = await readAgentCliConfig();

  assert.equal(normalizeBenchmarkAgentId("pi-agent", config), "pi");
  assert.equal(normalizeBenchmarkAgentId("codex-cli", config), "codex-cli");
  assert.equal(normalizeBenchmarkAgentId("claude-code", config), "claudecode");
  assert.equal(normalizeBenchmarkAgentId("open-code", config), "opencode");
  assert.equal(normalizeBenchmarkAgentId("tura-fast-shll", config), "tura");
});

test("all agent profiles default to GPT-5.6-Sol", async () => {
  const config = await readAgentCliConfig();

  for (const agent of config.agents) {
    assert.match(agent.defaultModel ?? "", /(?:^|\/)gpt-5\.6-sol$/, agent.id);
  }
});

test("agent cli resolver maps each agent to an editable launch command", async () => {
  const config = await readAgentCliConfig();
  const workspaceDirectory = "C:/workspace/task";
  const matrix = resolveBenchmarkAgentMatrix(config.defaultAgents, { workspaceDirectory, reasoning: "low" }, config);
  const byId = new Map(matrix.map((agent) => [agent.agentId, agent]));
  const pi = mustGet(byId, "pi");
  const codex = mustGet(byId, "codex-cli");
  const claudecode = mustGet(byId, "claudecode");
  const opencode = mustGet(byId, "opencode");
  const tura = mustGet(byId, "tura");

  assert.equal(pi.cliLaunchCommandName, "pi");
  assert.deepEqual(pi.cliArgs?.slice(0, 2), ["--mode", "json"]);
  assert.equal(codex.cliLaunchCommandName, "codex");
  assert.ok(codex.cliArgs?.includes(workspaceDirectory));
  assert.ok(codex.cliArgs?.includes("gpt-5.6-sol"));
  assert.equal(codex.agentVersion, "0.144.1");
  assert.equal(codex.githubRepositoryUrl, "https://github.com/openai/codex");
  assert.match(codex.releaseDownloadUrl ?? "", /rust-v0\.144\.1/);
  assert.match(codex.releaseSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(claudecode.cliLaunchCommandName, "claude");
  assert.ok(claudecode.cliArgs?.includes("stream-json"));
  assert.equal(opencode.cliLaunchCommandName, "opencode");
  assert.deepEqual(opencode.cliArgs?.slice(0, 2), ["run", "--model"]);
  assert.equal(tura.cliLaunchCommandName, "tura");
  assert.ok(tura.cliArgs?.includes("--cwd"));
  assert.equal(tura.env?.TURA_COMMAND_RUN_STRICT_JSON, "0");
});

test("agent cli resolver honors environment command and model overrides", async () => {
  const config = await readAgentCliConfig();
  const codex = resolveBenchmarkAgentCli(
    "codex-cli",
    {
      workspaceDirectory: "repo",
      env: {
        COMMAND_RUN_AGENT_CODEX_EXE: "C:/tools/codex.exe",
        COMMAND_RUN_AGENT_CODEX_MODEL: "openai/custom-codex",
      },
    },
    config,
  );

  assert.equal(codex.cliLaunchCommandName, "C:/tools/codex.exe");
  assert.ok(codex.cliArgs?.includes("openai/custom-codex"));
});

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  assert.ok(value, `missing map entry: ${String(key)}`);
  return value;
}
