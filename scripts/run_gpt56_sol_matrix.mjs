#!/usr/bin/env node
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { benchmarkRawRoot } from "./lib/business_paths.mjs"

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.dirname(benchmarkDir)
const rawRoot = benchmarkRawRoot()
const stamp = process.env.COMMAND_RUN_MATRIX_STAMP || timestamp()
const monitorMs = Math.max(10, Number(process.env.COMMAND_RUN_MATRIX_MONITOR_SECONDS || 60)) * 1000
const notBefore = Date.parse(process.env.COMMAND_RUN_MATRIX_NOT_BEFORE || "")
const selected = new Set(parseList(process.env.COMMAND_RUN_MATRIX_TASKS || "xsv,zip-password-finder,nushell,fullstack"))
const matrixRoot = path.join(rawRoot, "_gpt56-sol-matrix", stamp)
const logRoot = path.join(matrixRoot, "logs")
const manifestPath = path.join(matrixRoot, "matrix-manifest.json")

const tasks = [
  {
    id: "xsv",
    short: "xsv",
    testName: "project-rebuild-source-port",
    wrapper: "tasks/refactoring/source-port-python-default-xsv/runner.mjs",
  },
  {
    id: "zip-password-finder",
    short: "zip",
    testName: "project-rebuild-source-port",
    wrapper: "tasks/refactoring/source-port-python-default-zip-password-finder/runner.mjs",
  },
  {
    id: "nushell",
    short: "nu",
    testName: "project-rebuild-source-port",
    wrapper: "tasks/refactoring/source-port-python-default-nushell/runner.mjs",
  },
  {
    id: "fullstack",
    short: "fs",
    testName: "project-rebuild-makeup-tanstack-fullstack",
    wrapper: "tasks/refactoring/prompt-gallery-tanstack-fullstack-rebuild/runner.mjs",
    fullstack: true,
  },
].filter((task) => selected.has(task.id))

const variants = [
  { agent: "tura-balanced", short: "tb", replicate: 1, reasoning: "high" },
  { agent: "tura-balanced", short: "tb", replicate: 2, reasoning: "high" },
  { agent: "tura-direct", short: "td", replicate: 1, reasoning: "high" },
  { agent: "tura-direct", short: "td", replicate: 2, reasoning: "high" },
  { agent: "codex-cli", short: "cx", replicate: 1, reasoning: "medium" },
  { agent: "codex-cli", short: "cx", replicate: 2, reasoning: "medium" },
]
const variantSpecsByTask = parseVariantSpecs(process.env.COMMAND_RUN_MATRIX_VARIANTS_BY_TASK || "")

fs.mkdirSync(logRoot, { recursive: true })
if (tasks.length === 0) throw new Error("COMMAND_RUN_MATRIX_TASKS selected no known tasks")

const manifest = {
  schema: "tura.benchmark.gpt56-sol-matrix.v1",
  stamp,
  raw_root: rawRoot,
  matrix_root: matrixRoot,
  model: "gpt-5.6-sol",
  tura_model: "openai/gpt-5.6-sol",
  service_tier: "default",
  max_concurrency_per_task: 6,
  task_batches_are_sequential: true,
  task_variant_plan: Object.fromEntries(tasks.map((task) => [
    task.id,
    variantsForTask(task).map((variant) => variantKey(variant)),
  ])),
  tura_embedded: false,
  tura_sandbox: false,
  monitor_interval_ms: monitorMs,
  not_before: Number.isFinite(notBefore) ? new Date(notBefore).toISOString() : null,
  started_at: new Date().toISOString(),
  finished_at: null,
  runs: [],
}

if (Number.isFinite(notBefore) && notBefore > Date.now()) {
  console.log(`[matrix] waiting until ${new Date(notBefore).toISOString()}`)
  await delay(notBefore - Date.now())
}

for (const task of tasks) {
  const taskVariants = variantsForTask(task)
  if (taskVariants.length === 0) throw new Error(`no variants selected for ${task.id}`)
  console.log(`[matrix] starting ${task.id}: ${taskVariants.length} concurrent run(s)`)
  const runs = taskVariants.map((variant, index) => startRun(task, variant, index))
  manifest.runs.push(...runs)
  writeManifest()
  await monitorBatch(task, runs)
  console.log(`[matrix] finished ${task.id}: ${runs.map((run) => `${run.agent}#${run.replicate}=${run.exit_code}`).join(" ")}`)
}

manifest.finished_at = new Date().toISOString()
writeManifest()
console.log(`[matrix] all ${manifest.runs.length} runs settled; manifest=${manifestPath}`)

function startRun(task, variant, index) {
  const runId = `g56-${task.short}-${variant.short}${variant.replicate}-${stamp}`
  const runRoot = task.fullstack
    ? path.join(rawRoot, task.testName, runId)
    : path.join(rawRoot, task.testName, `r-${sha1(runId).slice(0, 10)}`)
  const summaryPath = path.join(runRoot, "summary.json")
  const stdoutPath = path.join(logRoot, `${runId}.stdout.log`)
  const stderrPath = path.join(logRoot, `${runId}.stderr.log`)
  const turaHome = path.join(matrixRoot, "tura-home", runId)
  const turaDbRoot = path.join(matrixRoot, "tura-db", runId)
  fs.mkdirSync(turaHome, { recursive: true })
  fs.mkdirSync(turaDbRoot, { recursive: true })
  const stdoutFd = fs.openSync(stdoutPath, "a")
  const stderrFd = fs.openSync(stderrPath, "a")
  const env = {
    ...process.env,
    TURA_BENCHMARK_RAW_ROOT: rawRoot,
    COMMAND_RUN_AGENT_RUN_ID: runId,
    COMMAND_RUN_AGENT_AGENTS: variant.agent,
    COMMAND_RUN_AGENT_CODEX_MODEL: "gpt-5.6-sol",
    COMMAND_RUN_AGENT_TURA_MODEL: "openai/gpt-5.6-sol",
    COMMAND_RUN_AGENT_REASONING_EFFORT: variant.reasoning,
    COMMAND_RUN_AGENT_SERVICE_TIER: "default",
    COMMAND_RUN_AGENT_TURA_EMBEDDED: "0",
    COMMAND_RUN_AGENT_TURA_ATTEMPTS: "1",
    COMMAND_RUN_AGENT_TIMEOUT_MS: "7200000",
    COMMAND_RUN_AGENT_ALLOW_FAILURE: "1",
    COMMAND_RUN_AGENT_CODEX_CLEAN_HOME: "1",
    COMMAND_RUN_AGENT_SKIP_TURA_BUILD: "1",
    TURA_HOME: turaHome,
    TURA_DB_ROOT: turaDbRoot,
    TURA_ROUTER_STDERR_LOG: path.join(logRoot, `${runId}.router.stderr.log`),
    ...(task.fullstack ? { COMMAND_RUN_MAKEUP_PORT: String(46000 + index * 20) } : {}),
  }
  const child = spawn(process.execPath, [path.join(benchmarkDir, task.wrapper)], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
  })
  fs.closeSync(stdoutFd)
  fs.closeSync(stderrFd)
  const run = {
    task: task.id,
    agent: variant.agent,
    replicate: variant.replicate,
    reasoning: variant.reasoning,
    service_tier: "default",
    run_id: runId,
    run_root: runRoot,
    summary_path: summaryPath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    pid: child.pid,
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    signal: null,
    spawn_error: null,
    progress: null,
    child,
  }
  child.on("error", (error) => { run.spawn_error = String(error.stack || error) })
  child.on("exit", (code, signal) => {
    run.exit_code = code
    run.signal = signal
    run.finished_at = new Date().toISOString()
  })
  return run
}

async function monitorBatch(task, runs) {
  while (runs.some((run) => run.finished_at === null)) {
    await delay(monitorMs)
    for (const run of runs) run.progress = readProgress(run)
    writeManifest()
    console.log(`[monitor ${new Date().toISOString()}] ${task.id} ${runs.map(formatProgress).join(" | ")}`)
  }
  for (const run of runs) run.progress = readProgress(run)
  writeManifest()
}

function readProgress(run) {
  const summary = readJson(run.summary_path)
  const agentSummary = findAgentSummary(run.run_root, run.agent)
  const current = agentSummary || summary?.results?.[0] || null
  return {
    summary_exists: Boolean(summary),
    in_progress: summary?.in_progress ?? current?.in_progress ?? (run.finished_at === null),
    elapsed_ms: current?.elapsed_ms ?? null,
    exit_code: current?.exit_code ?? current?.run?.status ?? null,
    usage: current?.usage ?? summary?.aggregate_usage ?? null,
    harness_score: current?.harness_score ?? current?.validation?.harness_score ?? null,
    standards_passed: current?.validation?.standards_passed ?? null,
    standards_total: current?.validation?.standards_total ?? null,
    stdout_bytes: fileSize(run.stdout_path),
    stderr_bytes: fileSize(run.stderr_path),
  }
}

function findAgentSummary(runRoot, agent) {
  const direct = path.join(runRoot, agent, "agent-summary.json")
  const nested = path.join(runRoot, agent === "fullstack" ? agent : "", "agent-summary.json")
  const sourcePort = path.join(runRoot, taskDirectoryFromRunRoot(runRoot), `${agent}-1`, "agent-summary.json")
  return readJson(direct) || readJson(nested) || readJson(sourcePort)
}

function taskDirectoryFromRunRoot(runRoot) {
  const run = manifest.runs.find((item) => item.run_root === runRoot)
  return run?.task === "zip-password-finder" ? "zip-password-finder" : run?.task || ""
}

function formatProgress(run) {
  const p = run.progress || {}
  const state = run.finished_at ? `exit:${run.exit_code}` : "running"
  const tokens = p.usage?.total_tokens ?? p.usage?.total ?? "-"
  const score = p.harness_score ?? (p.standards_passed != null ? `${p.standards_passed}/${p.standards_total}` : "-")
  return `${run.agent}#${run.replicate} ${state} tokens:${tokens} score:${score}`
}

function writeManifest() {
  const serializable = {
    ...manifest,
    runs: manifest.runs.map(({ child, ...run }) => run),
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf8")
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null }
}

function fileSize(file) {
  try { return fs.statSync(file).size } catch { return 0 }
}

function parseList(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean)
}

function parseVariantSpecs(value) {
  const result = new Map()
  for (const item of String(value).split(";").map((part) => part.trim()).filter(Boolean)) {
    const separator = item.indexOf("=")
    if (separator < 1) throw new Error(`invalid task variant spec: ${item}`)
    const task = item.slice(0, separator).trim()
    const variants = new Set(parseList(item.slice(separator + 1)).map((entry) => entry.toLowerCase()))
    result.set(task, variants)
  }
  return result
}

function variantsForTask(task) {
  const allowed = variantSpecsByTask.get(task.id)
  if (!allowed || allowed.has("all") || allowed.has("*")) return variants
  return variants.filter((variant) => allowed.has(variantKey(variant)) || allowed.has(`${variant.agent}#${variant.replicate}`))
}

function variantKey(variant) {
  return `${variant.short}${variant.replicate}`
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex")
}

function timestamp() {
  const now = new Date()
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
