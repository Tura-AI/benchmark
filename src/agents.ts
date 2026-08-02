import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { JsonObject } from "./contracts.js";
import type { AgentLaunchConfig } from "./preparer.js";

export const AGENT_CLI_CONFIG_SCHEMA = "tura.benchmark.agent-cli-config.v1";
export type BenchmarkAgentId = string;

export interface BenchmarkAgentCliProfile {
  id: BenchmarkAgentId;
  aliases: string[];
  agentName: string;
  provider?: string;
  defaultVersion?: string;
  githubRepositoryUrl?: string;
  releasePageUrl?: string;
  releaseDownloadUrl?: string;
  releaseSha256?: string;
  commandEnv: string;
  defaultCommand: string;
  versionEnv?: string;
  modelEnv?: string;
  defaultModel?: string;
  reasoningEnv?: string;
  defaultReasoning?: string;
  defaultArgs: string[];
  defaultEnv?: Record<string, string>;
  defaultVariables?: Record<string, string>;
  appendInstruction: boolean;
  pluginSkillGithubUrls: string[];
  releaseDownloadUrlEnv?: string;
  releaseSha256Env?: string;
}

export interface BenchmarkAgentCliConfig {
  schema: typeof AGENT_CLI_CONFIG_SCHEMA;
  defaultAgents: BenchmarkAgentId[];
  runtimeAliases?: BenchmarkRuntimeAgent[];
  agents: BenchmarkAgentCliProfile[];
}

export interface BenchmarkRuntimeAgent {
  id: string;
  profile: string;
  aliases: string[];
  kind: string;
  mode: string;
}

export interface ResolveBenchmarkAgentCliOptions {
  workspaceDirectory?: string;
  repoRoot?: string;
  model?: string;
  reasoning?: string;
  variables?: Record<string, string>;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  agentVersion?: string;
  agentApplicationVersion?: string;
  appendInstruction?: boolean;
}

export function defaultAgentConfigPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceConfigPath = path.resolve(
    moduleDirectory,
    "..",
    "config",
    "agents.json",
  );
  const compiledConfigPath = path.resolve(
    moduleDirectory,
    "..",
    "..",
    "config",
    "agents.json",
  );
  return moduleDirectory.endsWith(`${path.sep}dist${path.sep}src`)
    ? compiledConfigPath
    : sourceConfigPath;
}

export async function readAgentCliConfig(
  configPath = defaultAgentConfigPath(),
): Promise<BenchmarkAgentCliConfig> {
  const config = JSON.parse(
    await readFile(configPath, "utf8"),
  ) as BenchmarkAgentCliConfig;
  validateAgentCliConfig(config);
  return config;
}

export function validateAgentCliConfig(config: BenchmarkAgentCliConfig): void {
  if (config.schema !== AGENT_CLI_CONFIG_SCHEMA)
    throw new Error("invalid benchmark agent cli config schema");
  const ids = new Set<string>();
  for (const profile of config.agents) {
    if (!profile.id || !Array.isArray(profile.aliases))
      throw new Error("agent profile identity is incomplete");
    if (ids.has(profile.id))
      throw new Error(`duplicate benchmark agent id: ${profile.id}`);
    ids.add(profile.id);
    if (!profile.commandEnv || !profile.defaultCommand)
      throw new Error(`agent command mapping is incomplete: ${profile.id}`);
    if (!Array.isArray(profile.defaultArgs))
      throw new Error(`agent args must be an array: ${profile.id}`);
  }
  for (const id of config.defaultAgents) {
    const runtime = config.runtimeAliases?.find(
      (candidate) => candidate.id === id,
    );
    if (!ids.has(id) && !runtime)
      throw new Error(`default benchmark agent is not declared: ${id}`);
  }
  const runtimeNames = new Set<string>();
  for (const runtime of config.runtimeAliases ?? []) {
    if (
      !runtime.id ||
      !ids.has(runtime.profile) ||
      !runtime.kind ||
      !runtime.mode
    ) {
      throw new Error(
        `runtime agent mapping is incomplete: ${runtime.id || "unknown"}`,
      );
    }
    for (const name of [runtime.id, ...runtime.aliases]) {
      if (runtimeNames.has(name))
        throw new Error(`duplicate runtime agent name: ${name}`);
      runtimeNames.add(name);
    }
  }
}

export function normalizeBenchmarkAgentId(
  agentId: string,
  config: BenchmarkAgentCliConfig,
): BenchmarkAgentId {
  const normalized = agentId.trim().toLowerCase();
  const runtime = config.runtimeAliases?.find(
    (candidate) =>
      candidate.id === normalized || candidate.aliases.includes(normalized),
  );
  if (runtime) return runtime.profile;
  const profile = config.agents.find(
    (candidate) =>
      candidate.id === normalized || candidate.aliases.includes(normalized),
  );
  if (!profile) throw new Error(`unknown benchmark agent: ${agentId}`);
  return profile.id;
}

export function resolveBenchmarkAgentCli(
  agentId: string,
  options: ResolveBenchmarkAgentCliOptions,
  config: BenchmarkAgentCliConfig,
): AgentLaunchConfig {
  const requestedId = agentId.trim().toLowerCase();
  const runtime = config.runtimeAliases?.find(
    (candidate) =>
      candidate.id === requestedId || candidate.aliases.includes(requestedId),
  );
  const normalizedId = normalizeBenchmarkAgentId(agentId, config);
  const profile = config.agents.find(
    (candidate) => candidate.id === normalizedId,
  );
  if (!profile)
    throw new Error(`missing benchmark agent profile: ${normalizedId}`);
  const env = options.env ?? process.env;
  const modelCandidates = [
    configuredValue(options.model, "option:model"),
    configuredValue(
      readEnv(env, profile.modelEnv),
      profile.modelEnv ? `environment:${profile.modelEnv}` : undefined,
    ),
    configuredValue(profile.defaultModel, "config:agent.defaultModel"),
  ].filter((value): value is { value: string; source: string } =>
    Boolean(value),
  );
  const selectedModel = modelCandidates[0] ?? {
    value: "unknown",
    source: "fallback:unknown",
  };
  const model = selectedModel.value;
  const reasoning =
    options.reasoning ??
    readEnv(env, profile.reasoningEnv) ??
    profile.defaultReasoning ??
    "medium";
  const variables = {
    workspace: options.workspaceDirectory ?? ".",
    repoRoot: options.repoRoot ?? ".",
    ...profile.defaultVariables,
    ...(runtime?.kind === "tura" ? { turaAgentId: runtime.id } : {}),
    ...options.variables,
    model,
    reasoning,
  };
  const cliArgs = [
    ...profile.defaultArgs.map((arg) => expandTemplate(arg, variables)),
    ...(options.extraArgs ?? []),
  ];
  if (!cliArgs.includes(model)) {
    throw new Error(
      `${runtime?.id ?? normalizedId} adapter did not propagate requested model ${model}`,
    );
  }
  const modelConfiguration = {
    schema: "tura.benchmark.model-configuration.v1" as const,
    requested_model: model,
    effective_model: model,
    provider: profile.provider ?? "unknown",
    agent_id: runtime?.id ?? normalizedId,
    sources: {
      requested_model: selectedModel.source,
      effective_model: selectedModel.source,
    },
    overrides: modelCandidates.slice(1).map((candidate) => ({
      source: candidate.source,
      value: candidate.value,
      selected: false as const,
    })),
    declared_difference: null,
  };
  return {
    agentId: runtime?.id ?? normalizedId,
    agentName: profile.agentName,
    agentVersion:
      options.agentVersion ??
      readEnv(env, profile.versionEnv) ??
      profile.defaultVersion ??
      model,
    agentApplicationVersion:
      options.agentApplicationVersion ??
      readEnv(env, profile.versionEnv) ??
      profile.defaultVersion ??
      model,
    cliLaunchCommandName:
      readEnv(env, profile.commandEnv) ?? profile.defaultCommand,
    cliArgs,
    pluginSkillGithubUrls: profile.pluginSkillGithubUrls,
    githubRepositoryUrl: profile.githubRepositoryUrl,
    releasePageUrl: profile.releasePageUrl,
    releaseDownloadUrl:
      readEnv(env, profile.releaseDownloadUrlEnv) ?? profile.releaseDownloadUrl,
    releaseSha256:
      readEnv(env, profile.releaseSha256Env) ?? profile.releaseSha256,
    appendInstruction: options.appendInstruction ?? profile.appendInstruction,
    env: materializeEnv({
      ...profile.defaultEnv,
      ...(profile.modelEnv ? { [profile.modelEnv]: model } : {}),
      TURA_BENCHMARK_MODEL: model,
      TURA_BENCHMARK_MODEL_CONFIGURATION: JSON.stringify(modelConfiguration),
    }),
    modelConfiguration,
  };
}

export function resolveBenchmarkAgentMatrix(
  agentIds: readonly string[],
  options: ResolveBenchmarkAgentCliOptions,
  config: BenchmarkAgentCliConfig,
): AgentLaunchConfig[] {
  return agentIds.map((agentId) =>
    resolveBenchmarkAgentCli(agentId, options, config),
  );
}

export function agentCliConfigSummary(
  config: BenchmarkAgentCliConfig,
): JsonObject {
  return {
    schema: config.schema,
    defaultAgents: [...config.defaultAgents],
    agents: config.agents.map((profile) => ({
      id: profile.id,
      provider: profile.provider ?? null,
      aliases: profile.aliases,
      commandEnv: profile.commandEnv,
      defaultCommand: profile.defaultCommand,
      defaultArgs: profile.defaultArgs,
      modelEnv: profile.modelEnv ?? null,
      defaultModel: profile.defaultModel ?? null,
    })),
  };
}

function configuredValue(
  value: string | undefined,
  source: string | undefined,
): { value: string; source: string } | undefined {
  const normalized = value?.trim();
  return normalized && source ? { value: normalized, source } : undefined;
}

function readEnv(env: NodeJS.ProcessEnv, name?: string): string | undefined {
  if (!name) return undefined;
  const value = env[name];
  return value && value.trim() ? value : undefined;
}

function expandTemplate(
  value: string,
  variables: Record<string, string>,
): string {
  return value.replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_, name: string) => variables[name] ?? "",
  );
}

function materializeEnv(
  values?: Record<string, string>,
): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
}
