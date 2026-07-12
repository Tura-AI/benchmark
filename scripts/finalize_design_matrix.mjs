#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const planManifestPath = path.resolve(requiredEnv("COMMAND_RUN_DESIGN_MATRIX_PLAN_MANIFEST"))
const resultManifestPaths = parseList(requiredEnv("COMMAND_RUN_DESIGN_MATRIX_RESULT_MANIFESTS")).map((file) => path.resolve(file))
const outputRoot = path.resolve(requiredEnv("COMMAND_RUN_DESIGN_MATRIX_OUTPUT_ROOT"))
const plan = readJson(planManifestPath)
const manifests = resultManifestPaths.map(readJson)
const expected = expectedGroups(plan.jobs)
const successful = collectSuccessful(manifests)
const finalJobs = []

for (const [key, count] of expected) {
  const candidates = successful.get(key) || []
  assert.equal(candidates.length, count, `${key} expected ${count} successful runs, found ${candidates.length}`)
  candidates.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))
  candidates.forEach((job, index) => finalJobs.push({ ...job, replicate: index + 1 }))
}
finalJobs.sort((left, right) => left.taskId.localeCompare(right.taskId) || left.agentId.localeCompare(right.agentId) || left.replicate - right.replicate)

const aggregateUsage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 }
for (const job of finalJobs) {
  for (const key of Object.keys(aggregateUsage)) aggregateUsage[key] += Number(job.summary.usage?.[key] || 0)
}

const summary = {
  schema: "tura.benchmark.design-matrix-final.v1",
  ok: true,
  createdAt: new Date().toISOString(),
  planManifestPath,
  resultManifestPaths,
  totalRuns: finalJobs.length,
  aggregateUsage,
  jobs: finalJobs.map((job) => ({
    taskId: job.taskId,
    agentId: job.agentId,
    replicate: job.replicate,
    runRoot: job.runRoot,
    elapsedMs: job.summary.elapsed_ms,
    rounds: job.summary.rounds,
    usage: job.summary.usage,
    htmlPath: path.join(job.runRoot, "workspace", "index.html"),
    summaryPath: path.join(job.runRoot, "agent-summary.json"),
  })),
}
fs.mkdirSync(outputRoot, { recursive: true })
writeJson(path.join(outputRoot, "final-summary.json"), summary)
writeProgress(path.join(outputRoot, "progress.md"), summary)
console.log(`[design-matrix-final] runs=${finalJobs.length} total_tokens=${aggregateUsage.total_tokens}`)

function expectedGroups(jobs) {
  const result = new Map()
  for (const job of jobs) {
    const key = groupKey(job)
    result.set(key, (result.get(key) || 0) + 1)
  }
  return result
}

function collectSuccessful(items) {
  const result = new Map()
  const seen = new Set()
  for (const manifest of items) {
    for (const job of manifest.jobs || []) {
      if (seen.has(job.runRoot)) continue
      seen.add(job.runRoot)
      const summary = readJson(path.join(job.runRoot, "agent-summary.json"), false)
      if (!summary || summary.exit_code !== 0) continue
      assert(fs.existsSync(path.join(job.runRoot, "workspace", "index.html")), `successful run lacks index.html: ${job.runRoot}`)
      const key = groupKey(job)
      const values = result.get(key) || []
      values.push({ ...job, summary })
      result.set(key, values)
    }
  }
  return result
}

function groupKey(job) {
  return `${job.taskId}|${job.agentId}`
}

function writeProgress(file, value) {
  const lines = [
    "# Design Matrix Progress",
    "",
    `- Updated: ${value.createdAt}`,
    `- Status: complete`,
    `- Successful runs: ${value.totalRuns}/${value.totalRuns}`,
    `- Failed runs requiring retry: 0`,
    `- Total tokens: ${value.aggregateUsage.total_tokens}`,
    "",
    "| # | Task | Agent | Run | State | Elapsed | Tokens | HTML | Summary |",
    "|---:|---|---|---:|---|---:|---:|:---:|:---:|",
  ]
  value.jobs.forEach((job, index) => {
    lines.push(`| ${index + 1} | ${job.taskId} | ${job.agentId} | ${job.replicate} | finished | ${Math.round(job.elapsedMs / 1000)}s | ${job.usage?.total_tokens ?? 0} | yes | yes |`)
  })
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8")
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim()
  assert(value, `${name} is required`)
  return value
}

function parseList(value) {
  return String(value).split(";").map((item) => item.trim()).filter(Boolean)
}

function readJson(file, required = true) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch (error) {
    if (!required) return null
    throw error
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}
