#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = readJson(path.join(root, "deep_swe", "canonical_tasks.json"));
const canonicalTaskIds = canonical.tasks.map((task) => task.task_id);
const repairedTaskIds = new Set([
  "abs-stepped-slices",
  "yaegi-go-embed-directives",
  "numba-stencil-boundary-modes",
  "bandit-incremental-cache-control",
  "quill-shared-toolbar-focus",
]);

const args = parseArgs(process.argv.slice(2));
const oldSource = path.resolve(required(args.oldSource, "--old-source"));
const repairSource = path.resolve(
  required(args.repairSource, "--repair-source"),
);
const quillSource = path.resolve(required(args.quillSource, "--quill-source"));
const output = path.resolve(required(args.output, "--output"));

assert(
  !fs.existsSync(output),
  `refusing to overwrite merged source: ${output}`,
);
assertInside(path.join(root, "raw", "deep-swe"), output);

const sources = [oldSource, repairSource, quillSource].map((source) => ({
  source,
  manifest: readJson(path.join(source, "manifest.json")),
  selection: readJson(path.join(source, "selection.json")),
}));
const [oldRun, repairRun, quillRun] = sources;

const selectedJobs = [
  ...oldRun.manifest.jobs.filter(
    (job) =>
      canonicalTaskIds.includes(job.task.task_id) &&
      !repairedTaskIds.has(job.task.task_id),
  ),
  ...repairRun.manifest.jobs.filter(
    (job) =>
      repairedTaskIds.has(job.task.task_id) &&
      job.task.task_id !== "quill-shared-toolbar-focus",
  ),
  ...quillRun.manifest.jobs.filter(
    (job) => job.task.task_id === "quill-shared-toolbar-focus",
  ),
];

assert.equal(selectedJobs.length, 60, "merged source must contain 60 jobs");
const jobsByKey = new Map(selectedJobs.map((job) => [job.key, job]));
assert.equal(jobsByKey.size, 60, "merged source contains duplicate job keys");

const sourceForTask = new Map();
for (const taskId of canonicalTaskIds) {
  if (!repairedTaskIds.has(taskId)) sourceForTask.set(taskId, oldRun);
  else if (taskId === "quill-shared-toolbar-focus")
    sourceForTask.set(taskId, quillRun);
  else sourceForTask.set(taskId, repairRun);
}

const selectionTasks = canonicalTaskIds.map((taskId) => {
  const sourceRun = sourceForTask.get(taskId);
  const task = sourceRun.selection.tasks.find(
    (item) => item.task_id === taskId,
  );
  assert(task, `selection metadata is missing for ${taskId}`);
  return structuredClone(task);
});
const selection = {
  ...structuredClone(oldRun.selection),
  created_at: new Date().toISOString(),
  selection_source: "pinned-canonical-20-with-codex-high-repair",
  selection_scope: "full-canonical-set",
  canonical_task_count: canonicalTaskIds.length,
  tasks: selectionTasks,
};

fs.mkdirSync(path.join(output, "runs"), { recursive: true });
for (const [taskIndex, taskId] of canonicalTaskIds.entries()) {
  const sourceRun = sourceForTask.get(taskId);
  const sourceTaskRuns = path.join(sourceRun.source, "runs", taskId);
  const outputTaskRuns = path.join(output, "runs", taskId);
  assert(fs.existsSync(sourceTaskRuns), `missing source runs for ${taskId}`);
  fs.symlinkSync(sourceTaskRuns, outputTaskRuns, "junction");
  for (const replicate of [1, 2, 3]) {
    const jobKey = `${taskId}__codex-cli__r${replicate}`;
    const job = jobsByKey.get(jobKey);
    assert(job, `missing merged job ${jobKey}`);
    assert.equal(job.state, "completed", `${jobKey} agent state`);
    assert.equal(job.harness_state, "completed", `${jobKey} harness state`);
    assert([0, 1].includes(Number(job.harness_score)), `${jobKey} score`);
    job.taskIndex = taskIndex;
    job.batch_index = Math.floor(taskIndex / 5) + 1;
    job.task = structuredClone(selectionTasks[taskIndex]);
    job.workspace_path = path.join(
      output,
      "runs",
      taskId,
      `codex-cli-r${replicate}`,
      "workspace",
    );
  }
}

const jobs = canonicalTaskIds.flatMap((taskId) =>
  [1, 2, 3].map((replicate) =>
    jobsByKey.get(`${taskId}__codex-cli__r${replicate}`),
  ),
);
const manifest = {
  ...structuredClone(oldRun.manifest),
  run_id: path.basename(output),
  run_root: output,
  selection_path: path.join(output, "selection.json"),
  phase: "completed",
  started_at: earliest(sources.map(({ manifest: item }) => item.started_at)),
  finished_at: latest(sources.map(({ manifest: item }) => item.finished_at)),
  monitor_log: path.join(output, "PROGRESS.md"),
  stop_reason: null,
  current_batch: null,
  jobs,
};
delete manifest.harness_completed_only;
delete manifest.harness_agent_outputs;

writeJson(path.join(output, "selection.json"), selection);
writeJson(path.join(output, "manifest.json"), manifest);
fs.writeFileSync(
  path.join(output, "PROGRESS.md"),
  [
    "# Codex High canonical repair merge",
    "",
    `- Original correct jobs: 45 from ${slash(path.relative(root, oldSource))}`,
    `- Repaired non-Quill jobs: 12 from ${slash(path.relative(root, repairSource))}`,
    `- Repaired Quill jobs: 3 from ${slash(path.relative(root, quillSource))}`,
    "- Total: pinned canonical 20 tasks x 3 replicates = 60 jobs",
    "",
  ].join("\n"),
  "utf8",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      output,
      taskCount: canonicalTaskIds.length,
      jobCount: jobs.length,
      harnessCompleted: jobs.filter((job) => job.harness_state === "completed")
        .length,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--old-source") result.oldSource = argv[++index];
    else if (argument === "--repair-source")
      result.repairSource = argv[++index];
    else if (argument === "--quill-source") result.quillSource = argv[++index];
    else if (argument === "--output") result.output = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}

function earliest(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) || new Date().toISOString();
}

function required(value, label) {
  assert(value, `${label} is required`);
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function assertInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
