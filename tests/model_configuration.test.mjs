import assert from "node:assert/strict";
import test from "node:test";

import {
  readModelConfiguration,
  resolveModelConfiguration,
} from "../lib/model_configuration.mjs";

const adapters = [
  ["pi-agent", "COMMAND_RUN_AGENT_PI_MODEL"],
  ["codex-cli", "COMMAND_RUN_AGENT_CODEX_MODEL"],
  ["claude-code", "COMMAND_RUN_AGENT_CLAUDE_MODEL"],
  ["opencode", "COMMAND_RUN_AGENT_OPENCODE_MODEL"],
  ["balanced", "COMMAND_RUN_AGENT_TURA_MODEL"],
];

test("every adapter resolves the outer model before adapter fallbacks", () => {
  for (const [agentId, modelEnv] of adapters) {
    const resolved = resolveModelConfiguration({
      agentId,
      provider: "fixture",
      modelEnv,
      cliModel: "requested-model",
      defaultModel: "fallback-model",
      env: { [modelEnv]: "adapter-env-model" },
    });
    assert.equal(resolved.requested_model, "requested-model", agentId);
    assert.equal(resolved.effective_model, "requested-model", agentId);
    assert.equal(resolved.sources.requested_model, "cli:--model", agentId);
    assert.equal(resolved.provider, "fixture", agentId);
  }
});

test("environment and config sources are recorded", () => {
  const fromEnvironment = resolveModelConfiguration({
    agentId: "claude-code",
    provider: "anthropic",
    modelEnv: "COMMAND_RUN_AGENT_CLAUDE_MODEL",
    defaultModel: "opus",
    env: { COMMAND_RUN_AGENT_CLAUDE_MODEL: "sonnet" },
  });
  assert.equal(fromEnvironment.requested_model, "sonnet");
  assert.equal(
    fromEnvironment.sources.requested_model,
    "environment:COMMAND_RUN_AGENT_CLAUDE_MODEL",
  );

  const fromConfig = resolveModelConfiguration({
    agentId: "claude-code",
    provider: "anthropic",
    modelEnv: "COMMAND_RUN_AGENT_CLAUDE_MODEL",
    defaultModel: "opus",
    env: {},
  });
  assert.equal(fromConfig.requested_model, "opus");
  assert.equal(fromConfig.sources.requested_model, "config:agent.defaultModel");
});

test("undeclared requested/effective model drift fails preflight", () => {
  assert.throws(
    () =>
      resolveModelConfiguration({
        agentId: "claude-code",
        provider: "anthropic",
        cliModel: "requested-model",
        effectiveModel: "fallback-model",
        env: {},
      }),
    /declare the difference explicitly/,
  );

  const declared = resolveModelConfiguration({
    agentId: "balanced",
    provider: "openai",
    cliModel: "gpt-5.6-sol",
    effectiveModel: "openai/gpt-5.6-sol",
    declaredDifference: "provider-qualified adapter model",
    env: {},
  });
  assert.deepEqual(readModelConfiguration(JSON.stringify(declared)), declared);
});
