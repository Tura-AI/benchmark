import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsRoot = path.join(repoRoot, "results");
const outputPath = path.join(repoRoot, "reports", "command-data-audit.json");

const slash = (value) => value.replace(/\\/g, "/");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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

async function listEntries(dir) {
  if (!(await exists(dir))) return [];
  return readdir(dir, { withFileTypes: true });
}

async function walk(dir, predicate, output = []) {
  for (const entry of await listEntries(dir)) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(file, predicate, output);
    } else if (predicate(file, entry)) {
      output.push(file);
    }
  }
  return output;
}

async function discoverRunContracts() {
  return walk(resultsRoot, (file) => path.basename(file) === "benchmark-web-run.json")
    .then((files) => files.sort((left, right) => slash(left).localeCompare(slash(right))));
}

function usageSignature(usage = {}) {
  const values = [
    usage.inputTokens || 0,
    usage.cacheInputTokens || 0,
    usage.outputTokens || 0,
    usage.totalTokens || 0
  ];
  if (!values.some(Boolean)) return "";
  return values.join(":");
}

function firstLine(value) {
  return String(value || "").replace(/\r/g, "").split("\n").find((line) => line.trim())?.trim() || "";
}

function compact(value, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function workspaceRelativePath(value) {
  const text = String(value || "").replace(/\\/g, "/");
  const marker = "/workspace/";
  const index = text.lastIndexOf(marker);
  if (index >= 0) return text.slice(index + marker.length);
  return path.basename(text);
}

function fileChangeCommandLine(item) {
  const changes = Array.isArray(item?.changes) ? item.changes : [];
  const lines = changes.map((change) => {
    const kind = String(change?.kind || "change");
    const file = workspaceRelativePath(change?.path);
    return `${kind} ${file}`.trim();
  }).filter(Boolean);
  return `file_change\n${(lines.length ? lines.join("\n") : "file_change")}`.trim();
}

function classifyEmptyCommand(command) {
  if (command.isCommandRun === false) return "non-command-tool";
  const line = String(command.commandLine || "");
  if (/python\s+-m\s+py_compile/i.test(line)) return "expected-silent-py-compile";
  if (/Out-Null|Remove-Item|Set-Content|New-Item|Copy-Item|Move-Item|Stop-Process|git\s+(?:add|commit)|chmod|touch/i.test(line)) {
    return "expected-silent-command";
  }
  if (/Get-Content|Get-ChildItem|Select-String|Select-Object|Format-Table|rg\b|dir\b|ls\b/i.test(line)) {
    return "raw-log-empty-read-command";
  }
  return "raw-log-empty-command";
}

function commandOutput(command) {
  return [command.stdout, command.stderr, command.receipt].map((value) => String(value || "")).join("").trim();
}

function summarizeBy(items, key) {
  return items.reduce((memo, item) => {
    const value = item[key] || "unknown";
    memo[value] = (memo[value] || 0) + 1;
    return memo;
  }, {});
}

function rawToolEvents(events) {
  let step = 0;
  return events
    .filter((event) => event.type === "item.completed" && ["command_execution", "file_change"].includes(event.item?.type))
    .map((event) => {
      step += 1;
      const isCommandRun = event.item.type === "command_execution";
      return {
        step,
        id: event.item.id || "",
        type: event.item.type,
        isCommandRun,
        commandRunStep: isCommandRun && Number.isFinite(event.item.step) ? event.item.step : null,
        status: event.item.status || "",
        exitCode: isCommandRun && Number.isFinite(event.item.exit_code) ? event.item.exit_code : null,
        commandLine: isCommandRun ? String(event.item.command_line || event.item.command || "") : fileChangeCommandLine(event.item),
        stdout: isCommandRun
          ? String(event.item.aggregated_output || "").replace(/\r\n/g, "\n").trimEnd()
          : fileChangeCommandLine(event.item).replace(/^file_change\n?/, "")
      };
    });
}

async function sqliteFilesNear(runRoot) {
  const files = await walk(runRoot, (file) => /\.(?:sqlite3?|db)(?:$|-)/i.test(path.basename(file)));
  const sqliteFiles = files
    .filter((file) => !/-(?:shm|wal)$|\.lock$/i.test(file))
    .map((file) => slash(path.relative(runRoot, file)))
    .sort();
  return {
    sessionDbFiles: sqliteFiles.filter((file) => /(^|\/)(?:\.tura\/session_log\.sqlite3|db\/session_log\/index\.sqlite3)$/i.test(file)),
    otherSqliteFiles: sqliteFiles.filter((file) => !/(^|\/)(?:\.tura\/session_log\.sqlite3|db\/session_log\/index\.sqlite3)$/i.test(file))
  };
}

async function auditRun(contractPath) {
  const run = await readJson(contractPath);
  const contractsDir = path.dirname(contractPath);
  const runRoot = path.dirname(path.dirname(contractsDir));
  const stdoutPath = path.join(runRoot, "metadata", "agent.stdout.jsonl");
  const providerPath = path.join(runRoot, "metadata", "provider-calls-full.jsonl");
  const rawEvents = rawToolEvents(await readJsonLines(stdoutPath));
  const rawByStep = new Map(rawEvents.map((event) => [event.step, event]));
  const sqliteFiles = await sqliteFilesNear(runRoot);

  const result = {
    runId: run.id,
    task: run.task,
    agent: run.agent,
    contractPath: slash(path.relative(repoRoot, contractPath)),
    rawLogPath: slash(path.relative(repoRoot, stdoutPath)),
    providerLogPath: slash(path.relative(repoRoot, providerPath)),
    providerLogPresent: await exists(providerPath),
    sessionDbFiles: sqliteFiles.sessionDbFiles,
    otherSqliteFiles: sqliteFiles.otherSqliteFiles,
    contractCommands: 0,
    rawCommands: rawEvents.filter((event) => event.isCommandRun).length,
    rawTools: rawEvents.length,
    missingCommandLine: [],
    missingCommandRunStep: [],
    emptyCompletedCommands: [],
    rawCommandMismatches: [],
    duplicateAdjacentMessages: [],
    duplicateUsageSignatures: []
  };

  const seenUsage = new Set();
  let previousMessage = "";

  for (const round of run.rounds || []) {
    const signature = usageSignature(round.usage);
    if (signature) {
      if (seenUsage.has(signature)) {
        result.duplicateUsageSignatures.push({
          round: round.index,
          signature
        });
      }
      seenUsage.add(signature);
    }

    for (const message of round.messages || []) {
      const text = String(message.text || "").replace(/\s+/g, " ").trim();
      if (text && text === previousMessage) {
        result.duplicateAdjacentMessages.push({
          round: round.index,
          role: message.role,
          preview: compact(text)
        });
      }
      if (text) previousMessage = text;
    }

    for (const command of round.commands || []) {
      result.contractCommands += 1;
      if (!String(command.commandLine || "").trim()) {
        result.missingCommandLine.push({
          round: round.index,
          id: command.id || "",
          step: command.step || null
        });
      }

      if (run.agent?.startsWith("tura-") && command.isCommandRun !== false && !Number.isFinite(command.commandRunStep)) {
        result.missingCommandRunStep.push({
          round: round.index,
          id: command.id || "",
          step: command.step || null
        });
      }

      const raw = rawByStep.get(command.step);
      if (!raw) {
        result.rawCommandMismatches.push({
          round: round.index,
          step: command.step || null,
          reason: "missing matching raw tool event"
        });
      } else if ((command.isCommandRun !== false) !== raw.isCommandRun) {
        result.rawCommandMismatches.push({
          round: round.index,
          step: command.step || null,
          reason: "contract tool kind differs from raw log event",
          contractType: command.type || "",
          rawType: raw.type || ""
        });
      } else if (raw.commandLine !== command.commandLine) {
        result.rawCommandMismatches.push({
          round: round.index,
          step: command.step || null,
          reason: "contract commandLine differs from raw log command",
          contractPreview: compact(firstLine(command.commandLine)),
          rawPreview: compact(firstLine(raw.commandLine))
        });
      }

      if (command.isCommandRun !== false && command.status === "completed" && !commandOutput(command)) {
        result.emptyCompletedCommands.push({
          round: round.index,
          id: command.id || "",
          step: command.step || null,
          category: classifyEmptyCommand(command),
          exitCode: command.exitCode ?? null,
          rawExitCode: raw?.exitCode ?? null,
          rawOutputWasEmpty: raw ? !raw.stdout.trim() : null,
          commandRunStep: command.commandRunStep ?? null,
          sessionDbCandidatesInRun: sqliteFiles.sessionDbFiles.length,
          commandPreview: compact(firstLine(command.commandLine))
        });
      }
    }
  }

  return result;
}

async function main() {
  const contracts = await discoverRunContracts();
  const runs = [];

  for (const contractPath of contracts) {
    runs.push(await auditRun(contractPath));
  }

  const emptyCompletedCommands = runs.flatMap((run) => run.emptyCompletedCommands.map((command) => ({
    runId: run.runId,
    task: run.task,
    agent: run.agent,
    rawLogPath: run.rawLogPath,
    providerLogPresent: run.providerLogPresent,
    sessionDbFiles: run.sessionDbFiles,
    otherSqliteFiles: run.otherSqliteFiles,
    ...command
  })));

  const audit = {
    schema: "tura.benchmark.command-data-audit.v1",
    generatedBy: "scripts/audit-command-data.mjs",
    totals: {
      runs: runs.length,
      contractCommands: runs.reduce((sum, run) => sum + run.contractCommands, 0),
      rawCommands: runs.reduce((sum, run) => sum + run.rawCommands, 0),
      rawTools: runs.reduce((sum, run) => sum + run.rawTools, 0),
      missingCommandLine: runs.reduce((sum, run) => sum + run.missingCommandLine.length, 0),
      missingCommandRunStep: runs.reduce((sum, run) => sum + run.missingCommandRunStep.length, 0),
      rawCommandMismatches: runs.reduce((sum, run) => sum + run.rawCommandMismatches.length, 0),
      emptyCompletedCommands: emptyCompletedCommands.length,
      duplicateAdjacentMessages: runs.reduce((sum, run) => sum + run.duplicateAdjacentMessages.length, 0),
      duplicateUsageSignatures: runs.reduce((sum, run) => sum + run.duplicateUsageSignatures.length, 0)
    },
    emptyCompletedCommandsByAgent: summarizeBy(emptyCompletedCommands, "agent"),
    emptyCompletedCommandsByCategory: summarizeBy(emptyCompletedCommands, "category"),
    note: "Empty completed commands are not backfilled unless raw agent.stdout.jsonl or a run-local session DB has a concrete output. For codex-main result runs in this dataset, no run-local session DB exists; agent.stdout.jsonl is the command-output source of truth.",
    emptyCompletedCommands,
    runs
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  console.log(`Audited ${audit.totals.runs} runs.`);
  console.log(`- contract commands: ${audit.totals.contractCommands}`);
  console.log(`- raw commands: ${audit.totals.rawCommands}`);
  console.log(`- raw tools: ${audit.totals.rawTools}`);
  console.log(`- missing commandLine: ${audit.totals.missingCommandLine}`);
  console.log(`- missing Tura commandRunStep: ${audit.totals.missingCommandRunStep}`);
  console.log(`- raw command mismatches: ${audit.totals.rawCommandMismatches}`);
  console.log(`- duplicate adjacent messages: ${audit.totals.duplicateAdjacentMessages}`);
  console.log(`- duplicate usage signatures: ${audit.totals.duplicateUsageSignatures}`);
  console.log(`- empty completed commands: ${audit.totals.emptyCompletedCommands}`);
  console.log(`- ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
