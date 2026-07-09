import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsRoot = path.join(repoRoot, "results");
const schema = {
  run: "tura.benchmark.run.v1",
  round: "tura.benchmark.round.v1",
  taskReport: "tura.benchmark.task-report.v1",
  manifest: "tura.benchmark.contract-manifest.v1"
};

const jsonSpace = 2;
const slash = (value) => value.replace(/\\/g, "/");
const pad = (value, width = 2) => String(value).padStart(width, "0");
const slug = (value) => String(value || "")
  .toLowerCase()
  .replace(/reasoning/g, "")
  .replace(/\b(low|medium|high|max|default)\b/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .replace(/-{2,}/g, "-") || "unknown";

function toTitle(value) {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== null && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonLines(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, jsonSpace)}\n`, "utf8");
}

async function listDirectories(dir) {
  if (!(await exists(dir))) return [];
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }));
}

async function listFiles(dir) {
  if (!(await exists(dir))) return [];
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }));
}

async function discoverRuns() {
  const runs = [];
  for (const category of await listDirectories(resultsRoot)) {
    for (const report of await listDirectories(category.path)) {
      for (const task of await listDirectories(report.path)) {
        for (const agent of await listDirectories(task.path)) {
          for (const run of await listDirectories(agent.path)) {
            const contractsDir = path.join(run.path, "metadata", "contracts");
            if (await exists(path.join(contractsDir, "benchmark-web-run.json"))) {
              runs.push({ category, report, task, agent, run, contractsDir });
            }
          }
        }
      }
    }
  }
  return runs.sort((left, right) => slash(left.run.path).localeCompare(slash(right.run.path)));
}

function parseScoreFromName(name) {
  const match = name.match(/score-(\d+)-of-(\d+)/i);
  return match ? { passed: Number(match[1]), total: Number(match[2]) } : { passed: 0, total: 0 };
}

function normalizeStatus(passed, total) {
  if (!total) return "unknown";
  return passed >= total ? "pass" : "fail";
}

function usageFromSelection(selection, webRun) {
  const usage = selection?.usage || {};
  const source = webRun?.source || {};
  return {
    inputTokens: usage.inputTokens ?? source.inputTokens ?? 0,
    cacheInputTokens: usage.cacheInputTokens ?? source.cacheInputTokens ?? 0,
    outputTokens: usage.outputTokens ?? source.outputTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? source.reasoningTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? source.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens ?? source.totalTokens ?? 0,
    peakContext: source.peakContext ?? 0
  };
}

function meaningfulString(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => value && value.toLowerCase() !== "unknown") || "";
}

function roundUsage(round) {
  const usage = round.usage || {};
  return {
    inputTokens: round.inputTokens ?? usage.inputTokens ?? 0,
    cacheInputTokens: round.cacheInputTokens ?? usage.cacheInputTokens ?? 0,
    outputTokens: round.outputTokens ?? usage.outputTokens ?? 0,
    totalTokens: round.totalTokens ?? usage.totalTokens ?? 0
  };
}

function promptEquals(left, right) {
  return String(left || "").replace(/\s+/g, " ").trim() === String(right || "").replace(/\s+/g, " ").trim();
}

function normalizeMarkdownText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function emphasizePromptSections(value) {
  return normalizeMarkdownText(value)
    .replace(/^(Goal|Reference|Hard constraints|Equivalence requirements):$/gm, "**$1:**")
    .replace(/^Do not ask the user questions\./gm, "**Do not ask the user questions.**");
}

function formatAssistantMarkdown(value) {
  const text = normalizeMarkdownText(value);
  if (!text) return "";
  if (/\n\s*\n|^[-*#>`]/m.test(text)) return text;

  const sentences = text.split(/(?<=[.!?])\s+(?=(?:[`"“A-Z]))/).filter(Boolean);
  if (sentences.length < 2 || text.length < 180) return text;

  return sentences.join("\n\n");
}

function normalizeMessages(messages, promptText) {
  return (messages || [])
    .filter((message) => message?.role !== "user" || !promptEquals(message.text, promptText))
    .filter((message) => message?.role !== "user")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : String(message.role || "assistant"),
      format: "markdown",
      text: formatAssistantMarkdown(message.text)
    }))
    .filter((message) => message.text);
}

function firstLine(value) {
  return String(value || "").replace(/\r/g, "").split("\n").find((line) => line.trim())?.trim() || "";
}

function shorten(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function parseCommandPayload(commandLine) {
  const raw = String(commandLine || "").trim();
  if (!raw) return { toolName: "command", preview: "command" };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const command = parsed.command || parsed.cmd || parsed.script || "";
      return {
        toolName: parsed.tool || parsed.type || "shell_command",
        preview: shorten(firstLine(command))
      };
    }
  } catch {
    // Non-JSON command payloads are handled below.
  }

  const shellMatch = raw.match(/(?:pwsh|powershell|cmd(?:\.exe)?|bash|sh)(?:\.exe)?["\s]*.*?(?:-Command|-c|\/c)\s+(['"])([\s\S]*)\1/i);
  if (shellMatch) return { toolName: "shell_command", preview: shorten(firstLine(shellMatch[2])) };

  if (/apply_patch/i.test(raw)) return { toolName: "apply_patch", preview: shorten(firstLine(raw)) };

  return { toolName: "shell_command", preview: shorten(firstLine(raw)) };
}

function normalizeCommand(command, index, globalStep) {
  const parsed = parseCommandPayload(command?.commandLine);
  return {
    id: `command-${pad(globalStep, 4)}`,
    toolName: parsed.toolName,
    type: parsed.toolName,
    isCommandRun: true,
    step: globalStep,
    commandRunStep: Number.isFinite(command?.commandRunStep) ? command.commandRunStep : null,
    commandIndex: Number.isFinite(command?.commandIndex) ? command.commandIndex : null,
    providerToolCallId: command?.providerToolCallId || null,
    status: String(command?.status || "recorded"),
    commandLine: String(command?.commandLine || ""),
    preview: parsed.preview || parsed.toolName,
    exitCode: Number.isFinite(command?.exitCode) ? command.exitCode : null,
    receipt: String(command?.receipt || ""),
    stdout: String(command?.stdout || ""),
    stderr: String(command?.stderr || "")
  };
}

function parseAggregatedCommandOutput(item) {
  const raw = String(item?.aggregated_output || "").replace(/\r\n/g, "\n").trimEnd();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && ("stdout" in parsed || "stderr" in parsed || "exit_code" in parsed)) {
      const stdout = String(parsed.stdout || "").replace(/\r\n/g, "\n").trimEnd();
      const stderr = String(parsed.stderr || "").replace(/\r\n/g, "\n").trimEnd();
      return {
        stdout,
        stderr,
        receipt: [stdout, stderr].filter(Boolean).join("\n"),
        exitCode: Number.isFinite(parsed.exit_code) ? parsed.exit_code : null
      };
    }
  } catch {
    // Codex logs store plain aggregated output instead of a JSON console envelope.
  }

  return {
    stdout: raw,
    stderr: "",
    receipt: raw,
    exitCode: Number.isFinite(item?.exit_code) ? item.exit_code : null
  };
}

function normalizeExecutionCommand(item, globalStep) {
  const commandLine = String(item?.command_line || item?.command || "");
  const parsed = parseCommandPayload(commandLine);
  const output = parseAggregatedCommandOutput(item);
  const toolName = item?.command_type || parsed.toolName;
  return {
    id: `command-${pad(globalStep, 4)}`,
    toolName,
    type: toolName,
    isCommandRun: true,
    step: globalStep,
    commandRunStep: Number.isFinite(item?.step) ? item.step : null,
    commandIndex: Number.isFinite(item?.command_index) ? item.command_index : null,
    providerToolCallId: item?.provider_tool_call_id || null,
    status: String(item?.status || "completed"),
    commandLine,
    preview: parsed.preview || parsed.toolName,
    exitCode: Number.isFinite(item?.exit_code) ? item.exit_code : output.exitCode,
    receipt: output.receipt,
    stdout: output.stdout,
    stderr: output.stderr
  };
}

function workspaceRelativePath(value) {
  const text = String(value || "").replace(/\\/g, "/");
  const marker = "/workspace/";
  const index = text.lastIndexOf(marker);
  if (index >= 0) return text.slice(index + marker.length);
  return path.basename(text);
}

function normalizeFileChangeTool(item, globalStep) {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const lines = changes.map((change) => {
    const kind = String(change?.kind || "change");
    const file = workspaceRelativePath(change?.path);
    return `${kind} ${file}`.trim();
  }).filter(Boolean);
  const summary = lines.length ? lines.join("\n") : "file_change";
  const commandLine = `file_change\n${summary}`.trim();

  return {
    id: `command-${pad(globalStep, 4)}`,
    toolName: "file_change",
    type: "file_change",
    isCommandRun: false,
    step: globalStep,
    commandRunStep: null,
    commandIndex: null,
    providerToolCallId: null,
    status: String(item?.status || "completed"),
    commandLine,
    preview: shorten(firstLine(commandLine)),
    exitCode: null,
    receipt: summary,
    stdout: summary,
    stderr: ""
  };
}

function normalizeRound(round, index, promptText, state) {
  const commands = (round?.commands || []).map((command, commandIndex) => {
    state.commandStep += 1;
    return normalizeCommand(command, commandIndex, state.commandStep);
  });
  const messages = normalizeMessages(round?.messages || [], promptText);
  const usage = messages.some((message) => message.role === "assistant") ? roundUsage(round || {}) : {
    inputTokens: 0,
    cacheInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };

  return {
    schema: schema.round,
    id: `round-${pad(index + 1, 4)}`,
    index: index + 1,
    title: `Round ${pad(index + 1, 4)}`,
    intent: "agent-round",
    batch: {
      id: `batch-${pad(index + 1, 4)}`,
      sourceRoundIds: [round?.id || `source-round-${pad(index + 1, 4)}`],
      certainty: "collector-same-round"
    },
    usage,
    messages,
    commands
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    cacheInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function usageFromTokenEvent(event) {
  const usage = event?.usage || {};
  return {
    inputTokens: usage.input_tokens || 0,
    cacheInputTokens: usage.cached_input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
  };
}

function usageFromProviderCall(call) {
  const usage = call?.metrics?.usage || call?.response?.usage || {};
  const inputTokens = usage.input_tokens || usage.inputTokens || 0;
  const outputTokens = usage.output_tokens || usage.outputTokens || 0;
  return {
    inputTokens,
    cacheInputTokens: usage.cached_input_tokens || usage.cacheInputTokens || usage.input_tokens_details?.cached_tokens || 0,
    outputTokens,
    totalTokens: usage.total_tokens || usage.totalTokens || inputTokens + outputTokens
  };
}

function makeLogRound(index, sourceId) {
  return {
    schema: schema.round,
    id: `round-${pad(index + 1, 4)}`,
    index: index + 1,
    title: `Round ${pad(index + 1, 4)}`,
    intent: "agent-round",
    batch: {
      id: `batch-${pad(index + 1, 4)}`,
      sourceRoundIds: [sourceId || `stdout-round-${pad(index + 1, 4)}`],
      certainty: "collector-same-round"
    },
    usage: emptyUsage(),
    messages: [],
    commands: []
  };
}

function providerOutputText(call) {
  const direct = normalizeMarkdownText(call?.response?.output_text || "");
  if (direct) return formatAssistantMarkdown(direct);

  const output = call?.response?.output || [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      const text = normalizeMarkdownText(part?.text || part?.content || "");
      if (text) return formatAssistantMarkdown(text);
    }
  }
  return "";
}

function providerCommandRunIds(call) {
  return (call?.request?.messages || [])
    .filter((message) => message?.type === "function_call" && message?.name === "command_run" && message?.call_id)
    .map((message) => message.call_id);
}

function stdoutToolRecords(events) {
  const records = [];
  let commandStep = 0;
  let currentProviderToolCallId = null;

  for (const event of events) {
    const item = event.item || {};
    if (event.type === "item.completed" && item.type === "command_execution") {
      commandStep += 1;
      const command = normalizeExecutionCommand(item, commandStep);
      currentProviderToolCallId = command.providerToolCallId || currentProviderToolCallId;
      records.push({ command, providerToolCallId: command.providerToolCallId || currentProviderToolCallId });
      continue;
    }

    if (event.type === "item.completed" && item.type === "file_change") {
      commandStep += 1;
      records.push({
        command: normalizeFileChangeTool(item, commandStep),
        providerToolCallId: currentProviderToolCallId
      });
    }
  }

  return records;
}

async function roundsFromProviderLogs(providerFile, stdoutFile, promptText) {
  const calls = (await readJsonLines(providerFile))
    .filter((call) => call?.type === "llm_call" && call?.success !== false);
  if (!calls.length) return [];

  const toolRecords = stdoutToolRecords(await readJsonLines(stdoutFile));
  const toolsByProviderCall = new Map();
  const unassignedTools = [];

  for (const record of toolRecords) {
    if (!record.providerToolCallId) {
      unassignedTools.push(record.command);
      continue;
    }
    const bucket = toolsByProviderCall.get(record.providerToolCallId) || [];
    bucket.push(record.command);
    toolsByProviderCall.set(record.providerToolCallId, bucket);
  }

  const seenProviderToolCalls = new Set();
  const rounds = [];

  for (let index = 0; index < calls.length; index += 1) {
    const text = providerOutputText(calls[index]);
    if (!text || promptEquals(text, promptText)) continue;

    const nextCall = calls[index + 1];
    const providerToolCallIds = nextCall ? providerCommandRunIds(nextCall).filter((id) => !seenProviderToolCalls.has(id)) : [];
    const commands = [];
    for (const id of providerToolCallIds) {
      seenProviderToolCalls.add(id);
      commands.push(...(toolsByProviderCall.get(id) || []));
    }

    const round = makeLogRound(rounds.length, calls[index].call_id || calls[index].response?.id);
    round.messages.push({ role: "assistant", format: "markdown", text });
    round.usage = usageFromProviderCall(calls[index]);
    round.commands.push(...commands);
    if (providerToolCallIds.length) round.batch.sourceRoundIds.push(...providerToolCallIds);
    rounds.push(round);
  }

  const leftovers = [
    ...unassignedTools,
    ...[...toolsByProviderCall.entries()]
      .filter(([id]) => !seenProviderToolCalls.has(id))
      .flatMap(([, commands]) => commands)
  ];
  if (leftovers.length) {
    const target = rounds.at(-1) || makeLogRound(0, "provider-unassigned-tools");
    target.commands.push(...leftovers);
    if (!rounds.length) rounds.push(target);
  }

  return rounds.filter((round) => round.messages.length || round.commands.length);
}

async function roundsFromAgentStdout(file, promptText) {
  const events = await readJsonLines(file);
  if (!events.length) return [];

  const rounds = [];
  let current = null;
  let commandStep = 0;
  const seenUsage = new Set();

  const ensureRound = (sourceId = "") => {
    if (!current) {
      current = makeLogRound(rounds.length, sourceId);
      rounds.push(current);
    }
    return current;
  };

  for (const event of events) {
    const item = event.item || {};
    if (event.type === "item.completed" && item.type === "agent_message") {
      const text = formatAssistantMarkdown(item.text || item.content);
      if (!text || promptEquals(text, promptText)) continue;
      current = makeLogRound(rounds.length, item.id);
      current.messages.push({ role: "assistant", format: "markdown", text });
      rounds.push(current);
      continue;
    }

    if (event.type === "thread.token_usage.updated") {
      const usage = usageFromTokenEvent(event);
      const signature = usageSignature(usage);
      if (signature && !seenUsage.has(signature)) {
        seenUsage.add(signature);
        ensureRound("token-usage").usage = usage;
      }
      continue;
    }

    if (event.type === "item.completed" && item.type === "command_execution") {
      commandStep += 1;
      ensureRound(item.id).commands.push(normalizeExecutionCommand(item, commandStep));
      continue;
    }

    if (event.type === "item.completed" && item.type === "file_change") {
      commandStep += 1;
      ensureRound(item.id).commands.push(normalizeFileChangeTool(item, commandStep));
    }
  }

  return rounds.filter((round) => round.messages.length || round.commands.length);
}

function isZeroUsage(usage) {
  return !(Number(usage?.inputTokens || 0) || Number(usage?.outputTokens || 0) || Number(usage?.totalTokens || 0));
}

function isCommandOnlyRound(round) {
  return !round.messages.length && round.commands.length && isZeroUsage(round.usage);
}

function hasAssistantMessage(round) {
  return round.messages.some((message) => message.role === "assistant");
}

function renumberRounds(rounds) {
  return rounds.map((round, index) => ({
    ...round,
    id: `round-${pad(index + 1, 4)}`,
    index: index + 1,
    title: `Round ${pad(index + 1, 4)}`,
    batch: {
      ...round.batch,
      id: `batch-${pad(index + 1, 4)}`
    }
  }));
}

function usageSignature(usage) {
  if (isZeroUsage(usage)) return "";
  return [
    usage.inputTokens || 0,
    usage.cacheInputTokens || 0,
    usage.outputTokens || 0,
    usage.totalTokens || 0
  ].join(":");
}

function dedupeRoundUsage(rounds) {
  const seen = new Set();
  return rounds.map((round) => {
    const signature = usageSignature(round.usage);
    if (!signature) return round;
    if (!seen.has(signature)) {
      seen.add(signature);
      return round;
    }
    return {
      ...round,
      usage: {
        inputTokens: 0,
        cacheInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    };
  });
}

function coalesceRoundBatches(rounds) {
  const coalesced = [];

  for (const round of rounds) {
    const previous = coalesced.at(-1);
    if (previous && hasAssistantMessage(previous) && isCommandOnlyRound(round)) {
      previous.commands.push(...round.commands);
      previous.batch.sourceRoundIds.push(...round.batch.sourceRoundIds);
      previous.batch.certainty = "merged-command-only-zero-usage-after-agent-message";
      continue;
    }
    coalesced.push({
      ...round,
      commands: [...round.commands],
      messages: [...round.messages],
      batch: {
        ...round.batch,
        sourceRoundIds: [...round.batch.sourceRoundIds]
      }
    });
  }

  return dedupeRoundUsage(renumberRounds(coalesced));
}

function agentSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "unknown";
}

function canonicalRunName(taskId, agentId, rank, passed, total, runNumber) {
  return `${slug(taskId)}__${agentSlug(agentId)}__rank-${pad(rank)}__score-${passed}-of-${total}__run-${pad(runNumber)}`;
}

function normalizeModelId(value) {
  return String(value || "gpt-5.5").replace(/^openai\//i, "").replace(/^gpt-/i, "gpt");
}

function agentProfileFor(rawAgentId, modelValue, cliMetadata) {
  const model = normalizeModelId(modelValue);
  const effort = "medium";
  const raw = String(rawAgentId || "");
  const base = raw === "codex-main" ? "codex-cli" : raw;
  const provider = base.startsWith("tura") ? "tura" : "codex-cli";
  const mode = base === "tura-direct" ? "direct" : base === "tura-balanced" ? "balanced" : "cli";
  const id = `${base}-${model}-${effort}`;
  const software = cliMetadata?.software || {};
  const agent = cliMetadata?.agent || {};

  return {
    id,
    displayName: toDisplayAgentName(id),
    rawId: raw,
    provider,
    mode,
    model,
    reasoningEffort: effort,
    version: `${model}-${effort}`,
    runtime: {
      packageName: software.packageName || "",
      packageVersion: software.packageVersion || "",
      gitHead: software.gitHead || "",
      cliLaunchCommandName: agent.cliLaunchCommandName || "",
      agentApplicationVersion: agent.agentApplicationVersion || agent.agentVersion || model
    }
  };
}

function toDisplayAgentName(agentId) {
  if (agentId.startsWith("tura-direct")) return "Tura Direct GPT-5.5 Medium";
  if (agentId.startsWith("tura-balanced")) return "Tura Balanced GPT-5.5 Medium";
  if (agentId.startsWith("codex-cli")) return "Codex CLI GPT-5.5 Medium";
  return toTitle(agentId);
}

function systemInfoFromCli(cliMetadata) {
  const software = cliMetadata?.software || {};
  const version = String(software.systemSoftwareVersion || "");
  const osVersion = version.match(/\b\d+\.\d+\.\d+\b/)?.[0] || "";
  return {
    platform: software.platform || "",
    architecture: software.arch || "",
    os: software.platform === "win32" ? "Windows" : software.platform || "",
    osVersion,
    nodeVersion: software.nodeVersion || "",
    systemSoftwareVersion: software.systemSoftwareVersion || ""
  };
}

function environmentInfo(cliMetadata, runRoot) {
  const system = systemInfoFromCli(cliMetadata);
  return {
    os: {
      name: system.os,
      platform: system.platform,
      version: system.osVersion,
      architecture: system.architecture
    },
    node: {
      version: system.nodeVersion
    },
    browser: {
      name: "chromium",
      version: "",
      source: "playwright/browser-smoke-tests when present"
    },
    codeDecoder: {
      name: cliMetadata?.software?.packageName || "tura-ai",
      version: cliMetadata?.software?.packageVersion || "",
      gitHead: cliMetadata?.software?.gitHead || ""
    },
    workspace: {
      path: "workspace",
      source: "workspace"
    }
  };
}

function stripReasoningNames(value) {
  if (Array.isArray(value)) return value.map(stripReasoningNames);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => {
      return [key, stripReasoningNames(entry)];
    }));
}

async function rewriteRoundFiles(contractsDir, rounds) {
  const roundsDir = path.join(contractsDir, "rounds");
  await mkdir(roundsDir, { recursive: true });
  for (const file of await listFiles(roundsDir)) {
    if (file.name.endsWith(".json")) await rm(file.path);
  }
  for (const round of rounds) {
    await writeJson(path.join(roundsDir, `${round.id}.json`), round);
  }
}

async function normalizeRun(info, runNumber) {
  const runRoot = info.run.path;
  const selectionPath = path.join(runRoot, "selection-metadata.json");
  const promptPath = path.join(runRoot, "raw-first-round-prompt.txt");
  const webRunPath = path.join(info.contractsDir, "benchmark-web-run.json");
  const taskReportPath = path.join(info.contractsDir, "task-report.json");
  const agentRoundsPath = path.join(info.contractsDir, "agent-rounds.jsonl");
  const cliMetadataPath = path.join(info.contractsDir, "cli-metadata.json");
  const manifestPath = path.join(info.contractsDir, "contract-manifest.json");
  const agentStdoutPath = path.join(runRoot, "metadata", "agent.stdout.jsonl");
  const providerCallsPath = path.join(runRoot, "metadata", "provider-calls-full.jsonl");

  const selection = await readJson(selectionPath, {});
  const webRun = await readJson(webRunPath, {});
  const cliMetadata = await readJson(cliMetadataPath, {});
  const promptText = emphasizePromptSections(await readFile(promptPath, "utf8").catch(() => ""));
  const nameScore = parseScoreFromName(info.run.name);
  const passed = selection?.harness?.passed ?? nameScore.passed;
  const total = selection?.harness?.total ?? nameScore.total;
  const rank = Number(selection?.rank || info.run.name.match(/rank-(\d+)/i)?.[1] || runNumber);
  const taskId = selection?.task || info.task.name;
  const rawAgentId = selection?.agent || webRun?.metadata?.custom?.internalAgentId || webRun?.agent || info.agent.name;
  const usage = usageFromSelection(selection, webRun);
  const model = meaningfulString(
    selection?.agent_metadata?.model,
    webRun?.source?.model,
    webRun?.run?.model,
    webRun?.run?.runtimeModel,
    cliMetadata?.agent?.agentVersion,
    cliMetadata?.agent?.agentApplicationVersion
  );
  const agentProfile = agentProfileFor(rawAgentId, model, cliMetadata);
  const agentId = agentProfile.id;
  const runId = canonicalRunName(taskId, agentId, rank, passed, total, runNumber);
  const targetRoot = path.join(path.dirname(runRoot), runId);
  const targetContractsDir = path.join(targetRoot, "metadata", "contracts");
  const roundState = { commandStep: 0 };
  const stdoutRounds = await roundsFromAgentStdout(agentStdoutPath, promptText);
  const stdoutHasMessages = stdoutRounds.some((round) => round.messages.length);
  const providerRounds = stdoutHasMessages ? [] : await roundsFromProviderLogs(providerCallsPath, agentStdoutPath, promptText);
  const fallbackRounds = (webRun.rounds || []).map((round, index) => normalizeRound(round, index, promptText, roundState));
  const rounds = coalesceRoundBatches(providerRounds.length ? providerRounds : stdoutRounds.length ? stdoutRounds : fallbackRounds);
  const commandCount = rounds.reduce((sum, round) => sum + round.commands.length, 0);

  const contract = stripReasoningNames({
    schema: schema.run,
    id: runId,
    category: info.category.name,
    report: info.report.name,
    task: taskId,
    agent: agentId,
    rank,
    sessionName: runId,
    title: taskId,
    prompt: {
      path: "raw-first-round-prompt.txt",
      format: "markdown",
      text: promptText
    },
    source: {
      model,
      steps: rounds.length,
      costUsd: webRun?.source?.costUsd ?? 0,
      inputTokens: usage.inputTokens,
      cacheInputTokens: usage.cacheInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      totalTokens: usage.totalTokens,
      peakContext: usage.peakContext,
      commands: commandCount
    },
    result: {
      status: normalizeStatus(passed, total),
      score: total ? Math.round((passed / total) * 100) : 0,
      harness: { passed, total, label: `${passed}/${total}` }
    },
    run: {
      status: normalizeStatus(passed, total),
      agent: agentId,
      provider: agentProfile.provider,
      mode: agentProfile.mode,
      model
    },
    rounds,
    metadata: {
      common: {
        schema: "tura.benchmark.metadata.common.v1",
        category: info.category.name,
        report: info.report.name,
        task: taskId,
        runId,
        agentId,
        model,
        result: { passed, total, status: normalizeStatus(passed, total) }
      },
      agent: {
        schema: "tura.benchmark.agent-metadata.v1",
        id: agentProfile.id,
        name: agentProfile.displayName,
        provider: agentProfile.provider,
        mode: agentProfile.mode,
        model: agentProfile.model,
        effort: agentProfile.reasoningEffort,
        version: agentProfile.version,
        runtime: agentProfile.runtime
      },
      system: systemInfoFromCli(cliMetadata),
      environment: environmentInfo(cliMetadata, runRoot),
      custom: {
        internalAgentId: rawAgentId,
        internalAgentDirectory: info.agent.name,
        cliMetadata: stripReasoningNames(cliMetadata),
        paths: {
          root: ".",
          prompt: "raw-first-round-prompt.txt",
          contracts: "metadata/contracts",
          rounds: "metadata/contracts/rounds"
        }
      }
    }
  });

  const taskReport = {
    schema: schema.taskReport,
    runId,
    category: contract.category,
    report: contract.report,
    task: contract.task,
    agent: contract.agent,
    result: contract.result,
    source: contract.source,
    prompt: contract.prompt,
    rounds: rounds.map((round) => ({
      id: round.id,
      index: round.index,
      usage: round.usage,
      messageCount: round.messages.length,
      commandCount: round.commands.length
    }))
  };

  const manifest = {
    schema: schema.manifest,
    runId,
    files: {
      run: "metadata/contracts/benchmark-web-run.json",
      taskReport: "metadata/contracts/task-report.json",
      agentRounds: "metadata/contracts/agent-rounds.jsonl",
      rounds: rounds.map((round) => `metadata/contracts/rounds/${round.id}.json`),
      cliMetadata: "metadata/contracts/cli-metadata.json"
    },
    naming: {
      runDirectory: "task__agent__rank-XX__score-P-of-T__run-XX",
      roundFile: "round-XXXX.json"
    }
  };

  await writeFile(promptPath, `${promptText}\n`, "utf8");
  await writeJson(webRunPath, contract);
  await writeJson(taskReportPath, taskReport);
  await writeJson(manifestPath, manifest);
  await writeJson(cliMetadataPath, stripReasoningNames({ schema: "tura.benchmark.cli-metadata.v1", ...cliMetadata }));
  await rewriteRoundFiles(info.contractsDir, rounds);
  await writeFile(agentRoundsPath, `${rounds.map((round) => JSON.stringify(round)).join("\n")}\n`, "utf8");

  if (await exists(selectionPath)) await rm(selectionPath);

  if (path.basename(runRoot) !== runId) {
    if (await exists(targetRoot)) {
      throw new Error(`Cannot rename ${runRoot}; target already exists: ${targetRoot}`);
    }
    await rename(runRoot, targetRoot);
    return { oldName: info.run.name, newName: runId, path: targetRoot };
  }
  return { oldName: info.run.name, newName: runId, path: runRoot };
}

async function main() {
  const runs = await discoverRuns();
  const counters = new Map();
  const renamed = [];

  for (const run of runs) {
    const key = `${run.category.name}/${run.report.name}/${run.task.name}/${run.agent.name}`;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    renamed.push(await normalizeRun(run, next));
  }

  console.log(`Normalized ${renamed.length} benchmark runs.`);
  console.log(`Renamed ${renamed.filter((item) => item.oldName !== item.newName).length} run directories.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
