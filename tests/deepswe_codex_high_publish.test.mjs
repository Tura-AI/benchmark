import assert from "node:assert/strict";
import test from "node:test";

import { auditDeepSweCodexHighManifest } from "../scripts/publish_deepswe_codex_high.mjs";

test("Codex High publisher requires the exact 20x3, 5x3 batch contract", () => {
  const jobs = Array.from({ length: 20 }, (_, taskIndex) =>
    Array.from({ length: 3 }, (_, replicateIndex) => ({
      key: `task-${taskIndex}__codex-cli__r${replicateIndex + 1}`,
      task: { task_id: `task-${taskIndex}` },
      batch_index: Math.floor(taskIndex / 5) + 1,
      agent: "codex-cli",
      reasoning: "high",
      replicate: replicateIndex + 1,
      state: "completed",
      scheme_ok: true,
      docker_routing_ok: true,
      harness_state: "completed",
      harness_score: taskIndex % 2,
      round_count: 2,
      total_tokens: 100,
    })),
  ).flat();
  const manifest = {
    schema: "tura.benchmark.deep-swe-matrix.v1",
    benchmark: "datacurve-ai/deep-swe",
    benchmark_version: "v1.1",
    model: "gpt-5.6-sol",
    codex_cli_version: "0.144.1",
    concurrency: 15,
    task_batch_size: 5,
    task_batch_count: 4,
    runs_per_task_batch: 15,
    task_batches_are_sequential: true,
    planned_agent_runs: 60,
    planned_harness_runs: 60,
    phase: "completed",
    jobs,
  };
  assert.deepEqual(auditDeepSweCodexHighManifest(manifest), {
    taskCount: 20,
    replicateCount: 3,
    runCount: 60,
    harnessCompleted: 60,
  });
  assert.throws(
    () => auditDeepSweCodexHighManifest({ ...manifest, concurrency: 14 }),
    /14 !== 15/,
  );
  assert.throws(
    () =>
      auditDeepSweCodexHighManifest({
        ...manifest,
        jobs: jobs.map((job, index) =>
          index === 0 ? { ...job, reasoning: "medium" } : job,
        ),
      }),
    /medium.*high|high.*medium/,
  );
});
