import assert from "node:assert/strict";
import process from "node:process";

export const MODEL_CONFIGURATION_SCHEMA =
  "tura.benchmark.model-configuration.v1";

export function resolveModelConfiguration(options) {
  const env = options.env || process.env;
  const candidates = [
    candidate(options.cliModel, "cli:--model"),
    candidate(
      options.modelEnv ? env[options.modelEnv] : undefined,
      options.modelEnv ? `environment:${options.modelEnv}` : undefined,
    ),
    candidate(env.TURA_BENCHMARK_MODEL, "environment:TURA_BENCHMARK_MODEL"),
    candidate(options.configModel, "config:runtime.model"),
    candidate(options.defaultModel, "config:agent.defaultModel"),
  ].filter(Boolean);
  assert(candidates.length > 0, `no model configured for ${options.agentId}`);

  const selected = candidates[0];
  const effectiveModel = clean(options.effectiveModel) || selected.value;
  const difference =
    effectiveModel === selected.value
      ? null
      : clean(options.declaredDifference) || null;
  assert(
    effectiveModel === selected.value || difference,
    `${options.agentId} requested model ${selected.value} but adapter resolved ${effectiveModel}; declare the difference explicitly`,
  );

  return {
    schema: MODEL_CONFIGURATION_SCHEMA,
    requested_model: selected.value,
    effective_model: effectiveModel,
    provider: clean(options.provider) || providerFromModel(effectiveModel),
    agent_id: options.agentId,
    sources: {
      requested_model: selected.source,
      effective_model:
        effectiveModel === selected.value
          ? selected.source
          : clean(options.effectiveSource) || "adapter",
    },
    overrides: candidates.slice(1).map((item) => ({
      source: item.source,
      value: item.value,
      selected: false,
    })),
    declared_difference: difference,
  };
}

export function readModelConfiguration(value) {
  if (!value) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  assert.equal(parsed?.schema, MODEL_CONFIGURATION_SCHEMA);
  for (const field of [
    "requested_model",
    "effective_model",
    "provider",
    "agent_id",
  ]) {
    assert(clean(parsed[field]), `model configuration is missing ${field}`);
  }
  assert(
    parsed.requested_model === parsed.effective_model ||
      clean(parsed.declared_difference),
    `${parsed.agent_id} model difference is not declared`,
  );
  return parsed;
}

function candidate(value, source) {
  const normalized = clean(value);
  return normalized && source ? { value: normalized, source } : null;
}

function clean(value) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function providerFromModel(model) {
  const prefix = String(model).split("/", 1)[0].toLowerCase();
  if (["openai", "anthropic", "google", "mistral", "xai"].includes(prefix))
    return prefix;
  return "unknown";
}
