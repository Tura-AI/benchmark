#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { normalizeBusinessSummary } from "../lib/business_paths.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = parseArgs(process.argv.slice(2));
if (args["refresh-pricing"]) {
  refreshPublishedReportPricing(
    path.resolve(args["refresh-pricing"]),
    args.model,
  );
  process.exit(0);
}
const sourceRoot = path.resolve(requiredArg(args, "source"));
const reportId = requiredArg(args, "report-id");
const resultsRoot = path.join(repoRoot, "results", "rewrite");
const reportRoot = path.join(resultsRoot, reportId);
const tempRoot = path.join(
  resultsRoot,
  `.${reportId}.publishing-${process.pid}`,
);

assertSafeSource(sourceRoot);
assert(/^[A-Za-z0-9._-]+$/.test(reportId), `invalid report ID: ${reportId}`);
assert(!fs.existsSync(reportRoot), `report already exists: ${reportRoot}`);
if (fs.existsSync(tempRoot))
  fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

try {
  const summaries = findFiles(sourceRoot, "summary.json")
    .map((file) => ({ file, value: readJson(file) }))
    .filter(
      ({ value }) => Array.isArray(value.results) && value.results.length,
    );
  assert(summaries.length > 0, `no run summaries under ${sourceRoot}`);
  const manifestRuns = [];

  for (const { file: summaryPath, value: sourceSummary } of summaries) {
    assert.equal(
      sourceSummary.results.length,
      1,
      `publication expects one result per summary: ${summaryPath}`,
    );
    const sourceResult = sourceSummary.results[0];
    const task = String(sourceResult.task || sourceSummary.test_name || "");
    const agent = String(sourceResult.agent || "codex-cli");
    const replicate = replicateNumber(sourceSummary.run_id);
    const modelSlug = publicationModelSlug(
      sourceSummary.model ||
        sourceSummary.tura_model ||
        process.env.COMMAND_RUN_AGENT_CODEX_MODEL,
    );
    const runId = `${task}-${agent}-${modelSlug}-run-${String(replicate).padStart(2, "0")}`;
    const relativeRun = path.join(task, agent, runId);
    const tempRun = path.join(tempRoot, relativeRun);
    const tempMetadata = path.join(tempRun, "metadata");
    const tempWorkspace = path.join(tempRun, "workspace");
    const finalRun = path.join(reportRoot, relativeRun);
    const finalMetadata = path.join(finalRun, "metadata");
    const finalWorkspace = path.join(finalRun, "workspace");
    const sourceRun = path.dirname(summaryPath);
    const sourceAgent = path.dirname(sourceResult.stdout_path);
    const sourceWorkspace = path.resolve(sourceResult.workspace);

    fs.mkdirSync(tempMetadata, { recursive: true });
    copyTree(sourceAgent, tempMetadata, {
      excludeRootNames: new Set(["workspace", "codex-home-clean"]),
    });
    copyTree(sourceWorkspace, tempWorkspace, {
      excludedNames: new Set([
        ".git",
        "node_modules",
        "dist",
        "build",
        ".output",
        ".vinxi",
        "coverage",
      ]),
    });
    const prompt = recoverPrompt(sourceResult);
    fs.writeFileSync(
      path.join(tempRun, "raw-first-round-prompt.txt"),
      prompt,
      "utf8",
    );

    const targetPaths = {
      test_name: task,
      run_id: runId,
      user_workspace: finalWorkspace,
      target_root: reportRoot,
      run_root: tempMetadata,
      summary_path: path.join(tempMetadata, "summary.json"),
    };
    const normalized = normalizeBusinessSummary(sourceSummary, targetPaths);
    assert(
      !normalized.benchmark_contract_error,
      normalized.benchmark_contract_error,
    );

    const replacements = [
      [sourceWorkspace, finalWorkspace],
      [sourceAgent, finalMetadata],
      [sourceRun, finalRun],
      [tempRoot, reportRoot],
    ].sort((a, b) => b[0].length - a[0].length);
    const publishedSummary = replaceStrings(normalized, replacements);
    publishedSummary.user_workspace = finalWorkspace;
    publishedSummary.target_root = reportRoot;
    publishedSummary.run_root = finalMetadata;
    publishedSummary.summary_path = path.join(finalMetadata, "summary.json");
    rewriteJsonFiles(tempMetadata, replacements);
    rewriteContractJsonl(path.join(tempMetadata, "contracts"), replacements);
    writeJson(path.join(tempMetadata, "summary.json"), publishedSummary);
    writeRawAgentSummary(
      tempMetadata,
      publishedSummary.results[0],
      tempWorkspace,
    );

    const contractsDir = path.join(tempMetadata, "contracts");
    const contractNames = [
      "benchmark-web-run.json",
      "cli-metadata.json",
      "harness-report.json",
      "task-report.json",
      "agent-rounds.jsonl",
    ];
    writeJson(path.join(contractsDir, "contract-manifest.json"), {
      schema: "tura.benchmark.contract-manifest.v1",
      runId,
      contracts: contractNames,
    });

    const harness = readJson(path.join(contractsDir, "harness-report.json"));
    const taskReport = readJson(path.join(contractsDir, "task-report.json"));
    const webRun = readJson(path.join(contractsDir, "benchmark-web-run.json"));
    const expectedRounds = (publishedSummary.results || []).reduce(
      (total, result) => total + Number(result?.events?.llm_rounds || 0),
      0,
    );
    assert.equal(
      taskReport.rounds.length,
      expectedRounds,
      `${runId}: ${taskReport.rounds.length} published rounds != ${expectedRounds} observed LLM turns`,
    );
    manifestRuns.push({
      task,
      agent,
      agentId: harness.agentId,
      replicate,
      runId,
      passed: harness.score.passed,
      total: harness.score.total,
      totalTokens: taskReport.usage.totalTokens,
      costUsd: webRun.source.costUsd ?? null,
      rounds: taskReport.rounds.length,
    });
  }

  manifestRuns.sort((a, b) =>
    `${a.task}:${a.agent}:${a.replicate}`.localeCompare(
      `${b.task}:${b.agent}:${b.replicate}`,
    ),
  );
  writeJson(path.join(tempRoot, "canonical-manifest.json"), {
    schema: "tura.benchmark.canonical-manifest.v2",
    reportId,
    category: "rewrite",
    createdAt: new Date().toISOString(),
    canonicalRunCount: manifestRuns.length,
    runs: manifestRuns,
  });
  fs.renameSync(tempRoot, reportRoot);
  console.log(
    JSON.stringify(
      {
        reportRoot,
        runs: manifestRuns.length,
        rounds: manifestRuns.reduce((total, run) => total + run.rounds, 0),
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (fs.existsSync(tempRoot))
    fs.rmSync(tempRoot, { recursive: true, force: true });
  throw error;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function requiredArg(values, name) {
  const value = values[name];
  assert(value, `missing --${name}`);
  return value;
}

function assertSafeSource(value) {
  const rawRoot = path.join(repoRoot, "raw");
  const relative = path.relative(rawRoot, value);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `source must be inside ${rawRoot}: ${value}`,
  );
  assert(fs.existsSync(value), `missing source: ${value}`);
}

function findFiles(root, name) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === name) files.push(full);
    }
  }
  return files.sort();
}

function copyTree(source, target, options = {}) {
  const root = path.resolve(source);
  fs.cpSync(root, target, {
    recursive: true,
    force: true,
    filter: (item) => {
      const relative = path.relative(root, item);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.length === 1 && options.excludeRootNames?.has(parts[0]))
        return false;
      return !parts.some((part) => options.excludedNames?.has(part));
    },
  });
}

function writeRawAgentSummary(metadataDir, result, workspaceDir) {
  const summaryPath = path.join(metadataDir, "agent-summary.json");
  const summary = { ...result };
  if (summary.patch && typeof summary.patch === "object") {
    writeJson(summaryPath, summary);
    return;
  }
  const files = findFilesByExtension(workspaceDir, "");
  summary.patch = {
    capture: "published-workspace-snapshot",
    patch_path: null,
    patch_bytes: files.reduce(
      (total, file) => total + fs.statSync(file).size,
      0,
    ),
    changed_files: files.length,
  };
  writeJson(summaryPath, summary);
}

function refreshPublishedReportPricing(root, fallbackModel) {
  const resultsRoot = path.join(repoRoot, "results", "rewrite");
  const relative = path.relative(resultsRoot, root);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `report must be inside ${resultsRoot}: ${root}`,
  );
  const summaries = findFiles(root, "summary.json").filter(
    (file) =>
      path.basename(path.dirname(file)) === "metadata" &&
      fs.existsSync(path.join(path.dirname(file), "contracts")),
  );
  assert(summaries.length > 0, `no published summaries under ${root}`);
  const costsByRun = new Map();
  for (const summaryPath of summaries) {
    const metadataDir = path.dirname(summaryPath);
    const runDir = path.dirname(metadataDir);
    const runId = path.basename(runDir);
    const task = path.basename(path.dirname(path.dirname(runDir)));
    const existingTaskReport = readJson(
      path.join(metadataDir, "contracts", "task-report.json"),
    );
    const expectedRounds = existingTaskReport.rounds.length;
    const sourceSummary = readJson(summaryPath);
    if (
      !sourceSummary.model ||
      sourceSummary.model === "unknown" ||
      sourceSummary.tura_model === "unknown"
    ) {
      const cliMetadata = readJson(
        path.join(metadataDir, "contracts", "cli-metadata.json"),
      );
      sourceSummary.model =
        fallbackModel ||
        (cliMetadata.agent?.model === "unknown"
          ? null
          : cliMetadata.agent?.model);
    }
    assert(sourceSummary.model, `${runId}: model is unavailable`);
    const normalized = normalizeBusinessSummary(sourceSummary, {
      test_name: task,
      run_id: runId,
      user_workspace: path.join(runDir, "workspace"),
      target_root: root,
      run_root: metadataDir,
      summary_path: summaryPath,
    });
    assert(
      !normalized.benchmark_contract_error,
      normalized.benchmark_contract_error,
    );
    const refreshedTaskReport = readJson(
      path.join(metadataDir, "contracts", "task-report.json"),
    );
    assert.equal(
      refreshedTaskReport.rounds.length,
      expectedRounds,
      `${runId}: pricing refresh changed round count`,
    );
    writeJson(summaryPath, normalized);
    const webRun = readJson(
      path.join(metadataDir, "contracts", "benchmark-web-run.json"),
    );
    assert.equal(
      typeof webRun.source.costUsd,
      "number",
      `${runId}: missing cost`,
    );
    costsByRun.set(runId, webRun.source.costUsd);
  }
  const manifestPath = path.join(root, "canonical-manifest.json");
  const manifest = readJson(manifestPath);
  for (const run of manifest.runs || []) {
    assert(
      costsByRun.has(run.runId),
      `missing refreshed cost for ${run.runId}`,
    );
    run.costUsd = costsByRun.get(run.runId);
  }
  manifest.totalCostUsd = roundUsd(
    (manifest.runs || []).reduce(
      (total, run) => total + Number(run.costUsd || 0),
      0,
    ),
  );
  writeJson(manifestPath, manifest);
  console.log(
    JSON.stringify(
      {
        reportRoot: root,
        runs: summaries.length,
        totalCostUsd: manifest.totalCostUsd,
      },
      null,
      2,
    ),
  );
}

function roundUsd(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function replicateNumber(runId) {
  const match = String(runId || "").match(/(?:r|run-)(\d+)$/i);
  assert(match, `cannot infer replicate from ${runId}`);
  return Number(match[1]);
}

function publicationModelSlug(model) {
  return String(model || "unknown")
    .replace(/^gpt-/i, "gpt")
    .replace(/\./g, "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .toLowerCase();
}

function recoverPrompt(result) {
  const candidates = [
    result?.prep?.prompt_path,
    result?.context_archive?.input_prompt_path,
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      const text = fs.readFileSync(candidate, "utf8");
      if (text.trim()) return text;
    }
  }
  for (const rolloutPath of result?.context_archive?.codex_rollout_paths ||
    []) {
    if (!rolloutPath || !fs.existsSync(rolloutPath)) continue;
    for (const line of fs.readFileSync(rolloutPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = record?.payload;
      if (payload?.type !== "message" || payload?.role !== "user") continue;
      const text = messageText(payload.content);
      if (text.trim()) return text;
    }
  }
  return "";
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      typeof item === "string"
        ? item
        : String(item?.text || item?.input_text || item?.content || ""),
    )
    .filter(Boolean)
    .join("\n");
}

function rewriteJsonFiles(root, replacements) {
  for (const file of findJsonFiles(root)) {
    writeJson(file, replaceStrings(readJson(file), replacements));
  }
}

function rewriteContractJsonl(contractsDir, replacements) {
  if (!fs.existsSync(contractsDir)) return;
  for (const file of findFilesByExtension(contractsDir, ".jsonl")) {
    const lines = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) =>
        JSON.stringify(replaceStrings(JSON.parse(line), replacements)),
      );
    fs.writeFileSync(
      file,
      `${lines.join("\n")}${lines.length ? "\n" : ""}`,
      "utf8",
    );
  }
}

function findJsonFiles(root) {
  return findFilesByExtension(root, ".json");
}

function findFilesByExtension(root, extension) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(extension))
        files.push(full);
    }
  }
  return files;
}

function replaceStrings(value, replacements) {
  if (typeof value === "string") {
    let output = value;
    for (const [source, target] of replacements)
      output = output.split(source).join(target);
    return output;
  }
  if (Array.isArray(value))
    return value.map((item) => replaceStrings(item, replacements));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceStrings(item, replacements),
      ]),
    );
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
