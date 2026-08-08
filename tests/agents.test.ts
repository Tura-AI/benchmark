import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBenchmarkAgentId,
  readAgentCliConfig,
  resolveBenchmarkAgentCli,
  resolveBenchmarkAgentMatrix,
} from "../src/agents.js";

test("agent cli config declares a configurable default matrix", async () => {
  const config = await readAgentCliConfig();

  assert.ok(config.defaultAgents.length > 0);
  assert.ok(
    config.defaultAgents.every((id) =>
      config.runtimeAliases?.some((agent) => agent.id === id),
    ),
  );
  assert.ok(config.runtimeAliases?.some((agent) => agent.id === "balanced"));
  assert.ok(config.runtimeAliases?.some((agent) => agent.id === "direct"));
  assert.ok(config.runtimeAliases?.some((agent) => agent.id === "mini"));
  assert.ok(config.runtimeAliases?.some((agent) => agent.id === "mini-macro"));
  assert.ok(
    config.runtimeAliases?.some((agent) => agent.id === "direct-text-only"),
  );
});

test("agent aliases normalize to canonical ids", async () => {
  const config = await readAgentCliConfig();

  assert.equal(normalizeBenchmarkAgentId("pi-agent", config), "pi");
  assert.equal(normalizeBenchmarkAgentId("codex-cli", config), "codex-cli");
  assert.equal(normalizeBenchmarkAgentId("claude-code", config), "claudecode");
  assert.equal(normalizeBenchmarkAgentId("open-code", config), "opencode");
  assert.equal(normalizeBenchmarkAgentId("balanced", config), "tura");
  assert.equal(normalizeBenchmarkAgentId("plain-mini", config), "mini");
  assert.equal(normalizeBenchmarkAgentId("macro-mini", config), "mini-macro");
  assert.throws(
    () => normalizeBenchmarkAgentId("unknown-agent", config),
    /unknown benchmark agent/,
  );
});

test("all agent profiles expose configurable command and model environment names", async () => {
  const config = await readAgentCliConfig();

  for (const agent of config.agents) {
    assert.ok(agent.commandEnv, agent.id);
    assert.ok(agent.modelEnv, agent.id);
    assert.ok(agent.provider, agent.id);
  }
});

test("agent cli resolver maps each agent to an editable launch command", async () => {
  const config = await readAgentCliConfig();
  const workspaceDirectory = "C:/workspace/task";
  const matrix = resolveBenchmarkAgentMatrix(
    config.defaultAgents,
    { workspaceDirectory, reasoning: "low" },
    config,
  );
  const byId = new Map(matrix.map((agent) => [agent.agentId, agent]));
  const pi = mustGet(byId, "pi-agent");
  const codex = mustGet(byId, "codex-cli");
  const claudecode = mustGet(byId, "claude-code");
  const opencode = mustGet(byId, "opencode");
  const tura = mustGet(byId, "balanced");

  for (const [agentId, resolved] of byId) {
    const profile = config.agents.find(
      (candidate) =>
        candidate.id === normalizeBenchmarkAgentId(agentId, config),
    );
    assert.equal(
      resolved.modelConfiguration?.requested_model,
      profile?.defaultModel,
    );
    assert.equal(
      resolved.modelConfiguration?.effective_model,
      profile?.defaultModel,
    );
    assert.equal(resolved.modelConfiguration?.agent_id, agentId);
    assert.equal(
      resolved.env?.[profile?.modelEnv ?? ""],
      profile?.defaultModel,
    );
  }

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
  assert.ok(tura.cliArgs?.includes("balanced"));
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

test("mini profiles resolve their renamed local projects", async () => {
  const config = await readAgentCliConfig();
  const repoRoot = "C:/workspace/tura-benchmark";
  const workspaceDirectory = "C:/workspace/task";
  const plain = resolveBenchmarkAgentCli(
    "mini",
    { repoRoot, workspaceDirectory },
    config,
  );
  const macro = resolveBenchmarkAgentCli(
    "mini-macro",
    { repoRoot, workspaceDirectory },
    config,
  );

  assert.equal(plain.cliLaunchCommandName, "uv");
  assert.ok(plain.cliArgs?.includes(`${repoRoot}/mini_swe/mini-swe-agent`));
  assert.ok(plain.cliArgs?.includes("openai/gpt-5.6-sol"));
  assert.ok(
    plain.cliArgs?.includes("model.model_kwargs.reasoning_effort=high"),
  );
  assert.equal(macro.agentName, "Mini SWE Agent (tura_runtime)");
  assert.equal(macro.cliLaunchCommandName, "uv");
  assert.ok(
    macro.cliArgs?.includes(`${repoRoot}/mini_swe/mini-swe-agent-macro`),
  );
  assert.ok(
    macro.cliArgs?.includes(
      `${workspaceDirectory}/.mini-swe-agent-macro.trajectory.json`,
    ),
  );
});

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  assert.ok(value, `missing map entry: ${String(key)}`);
  return value;
}
