#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const matrixRoot = path.resolve(requiredEnv("COMMAND_RUN_DESIGN_MATRIX_ROOT"))
const manifestPath = path.join(matrixRoot, "matrix-manifest.json")
const progressPath = process.env.COMMAND_RUN_DESIGN_MATRIX_PROGRESS_PATH || path.join(matrixRoot, "progress.md")
const monitorMs = Math.max(10, Number(process.env.COMMAND_RUN_DESIGN_MATRIX_MONITOR_SECONDS || 120)) * 1000
const manifest = readJson(manifestPath)
assert(Array.isArray(manifest.jobs) && manifest.jobs.length > 0, "matrix manifest has no jobs")

let jobs = refresh()
writeProgress(jobs)
console.log(`[matrix-monitor] ${line(jobs)}`)
while (jobs.some((job) => job.status === "running" || job.status === "queued")) {
  await delay(monitorMs)
  jobs = refresh()
  writeProgress(jobs)
  console.log(`[matrix-monitor ${new Date().toISOString()}] ${line(jobs)}`)
}

function refresh() {
  return manifest.jobs.map((job) => {
    const summary = readJson(path.join(job.runRoot, "agent-summary.json"))
    const status = readJson(path.join(job.runRoot, "metadata", "status.json"))
    const runExists = fs.existsSync(job.runRoot)
    const state = summary
      ? (summary.exit_code === 0 ? "finished" : "failed")
      : status?.status === "closed" || status?.status === "error"
        ? "settling"
        : runExists ? "running" : "queued"
    return {
      ...job,
      status: state,
      progress: {
        elapsedMs: summary?.elapsed_ms ?? status?.elapsed_ms ?? null,
        totalTokens: summary?.usage?.total_tokens ?? null,
        htmlReady: fs.existsSync(path.join(job.runRoot, "workspace", "index.html")),
        summaryReady: Boolean(summary),
      },
    }
  })
}

function writeProgress(current) {
  const counts = count(current)
  const lines = [
    "# Design Matrix Progress",
    "",
    `- Updated: ${new Date().toISOString()}`,
    `- Matrix: ${manifest.stamp}`,
    `- Model: ${manifest.model} / ${manifest.turaModel}`,
    `- Reasoning: ${manifest.reasoning}`,
    `- Concurrency: ${manifest.concurrency}`,
    `- Progress: ${counts.finished + counts.failed}/${current.length} settled (${counts.running} running, ${counts.queued} queued, ${counts.failed} failed)`,
    "",
    "| # | Task | Agent | Run | State | Elapsed | Tokens | HTML | Summary |",
    "|---:|---|---|---:|---|---:|---:|:---:|:---:|",
  ]
  for (const job of current) {
    lines.push(`| ${job.index} | ${job.taskId} | ${job.agentId} | ${job.replicate} | ${job.status} | ${duration(job.progress.elapsedMs)} | ${job.progress.totalTokens ?? "—"} | ${job.progress.htmlReady ? "yes" : "no"} | ${job.progress.summaryReady ? "yes" : "no"} |`)
  }
  fs.mkdirSync(path.dirname(progressPath), { recursive: true })
  fs.writeFileSync(progressPath, `${lines.join("\n")}\n`, "utf8")
}

function count(current) {
  const result = { queued: 0, running: 0, settling: 0, finished: 0, failed: 0 }
  for (const job of current) result[job.status] += 1
  result.running += result.settling
  return result
}

function line(current) {
  const counts = count(current)
  return `${counts.finished + counts.failed}/${current.length} settled; running=${counts.running} queued=${counts.queued} failed=${counts.failed}`
}

function duration(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) / 1000)}s` : "—"
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim()
  assert(value, `${name} is required`)
  return value
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
