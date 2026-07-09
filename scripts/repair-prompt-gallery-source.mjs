import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const benchmarkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const turaRoot = process.env.TURA_REPO_DIR
  ? path.resolve(process.env.TURA_REPO_DIR)
  : path.resolve(benchmarkRoot, "..", "tura");
const resultsRoot = path.join(benchmarkRoot, "results", "refactoring");
const sourceRunner = path.join(turaRoot, "benchmark", "tasks", "refactoring", "prompt-gallery-tanstack-rebuild", "runner.mjs");
const oldTaskId = "prompt-gallery";
const fullstackTaskId = "prompt-gallery-tanstack-fullstack-rebuild";

const pad = (value, width = 2) => String(value).padStart(width, "0");
const slug = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

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

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function extractTemplate(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Cannot find prompt marker: ${marker}`);

  const returnIndex = source.lastIndexOf("return `", markerIndex);
  if (returnIndex < 0) throw new Error(`Cannot find template return after: ${marker}`);

  const start = returnIndex + "return `".length;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "`" && source[index - 1] !== "\\") return source.slice(start, index);
  }

  throw new Error(`Cannot find template end after: ${marker}`);
}

function fullstackPromptFromRunner(source) {
  return extractTemplate(source, "You are in a directory containing makeup.html and README-task.md. Turn this HTML into a production-quality full-stack TanStack Start prompt marketplace")
    .replaceAll("${reasoning}", "low")
    .replace(/^(What matters most|Important constraints):$/gm, "**$1:**")
    .trim();
}

function parseScore(runName) {
  const match = runName.match(/rank-(\d+)__score-(\d+)-of-(\d+)__run-(\d+)/);
  if (!match) return { rank: 1, passed: 0, total: 0, run: 1 };
  return {
    rank: Number(match[1]),
    passed: Number(match[2]),
    total: Number(match[3]),
    run: Number(match[4])
  };
}

function canonicalRunName(agent, score) {
  return `${fullstackTaskId}__${slug(agent)}__rank-${pad(score.rank)}__score-${score.passed}-of-${score.total}__run-${pad(score.run)}`;
}

async function listDirectories(dir) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }));
}

async function repairRun(runDir, agent, promptText) {
  const score = parseScore(runDir.name);
  const runId = canonicalRunName(agent, score);
  const promptPath = path.join(runDir.path, "raw-first-round-prompt.txt");
  const contractsDir = path.join(runDir.path, "metadata", "contracts");
  const webRunPath = path.join(contractsDir, "benchmark-web-run.json");
  const taskReportPath = path.join(contractsDir, "task-report.json");
  const manifestPath = path.join(contractsDir, "contract-manifest.json");

  await writeFile(promptPath, `${promptText}\n`, "utf8");

  if (await exists(webRunPath)) {
    const webRun = await readJson(webRunPath);
    webRun.id = runId;
    webRun.task = fullstackTaskId;
    webRun.sessionName = runId;
    webRun.title = "Prompt gallery TanStack full-stack rebuild";
    webRun.prompt = {
      path: "raw-first-round-prompt.txt",
      format: "markdown",
      text: promptText
    };
    await writeJson(webRunPath, webRun);
  }

  if (await exists(taskReportPath)) {
    const taskReport = await readJson(taskReportPath);
    taskReport.runId = runId;
    taskReport.task = fullstackTaskId;
    taskReport.prompt = {
      path: "raw-first-round-prompt.txt",
      format: "markdown",
      text: promptText
    };
    await writeJson(taskReportPath, taskReport);
  }

  if (await exists(manifestPath)) {
    const manifest = await readJson(manifestPath);
    manifest.runId = runId;
    await writeJson(manifestPath, manifest);
  }

  if (runDir.name !== runId) {
    const target = path.join(path.dirname(runDir.path), runId);
    if (await exists(target)) throw new Error(`Cannot rename ${runDir.path}; target exists: ${target}`);
    await rename(runDir.path, target);
    return { oldName: runDir.name, newName: runId };
  }

  return { oldName: runDir.name, newName: runId };
}

async function main() {
  const runnerSource = await readFile(sourceRunner, "utf8");
  const promptText = fullstackPromptFromRunner(runnerSource);
  const repaired = [];

  for (const report of await listDirectories(resultsRoot)) {
    const oldTaskDir = path.join(report.path, oldTaskId);
    const taskDir = path.join(report.path, fullstackTaskId);

    if (await exists(oldTaskDir)) {
      if (await exists(taskDir)) throw new Error(`Cannot rename ${oldTaskDir}; target exists: ${taskDir}`);
      await rename(oldTaskDir, taskDir);
    }

    if (!(await exists(taskDir))) continue;

    for (const agent of await listDirectories(taskDir)) {
      for (const run of await listDirectories(agent.path)) {
        if (!(await exists(path.join(run.path, "metadata", "contracts", "benchmark-web-run.json")))) continue;
        repaired.push(await repairRun(run, agent.name, promptText));
      }
    }
  }

  console.log(`Repaired ${repaired.length} Prompt Gallery runs from ${sourceRunner}.`);
  console.log(`Renamed ${repaired.filter((item) => item.oldName !== item.newName).length} run directories.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
