import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_CONCURRENCY,
  HARNESS_IMAGE_CONCURRENCY,
  VERIFIER_COMMAND,
  buildHarnessBatches,
  validHarnessReport,
} from "../deep_swe/harness.mjs";

test("DeepSWE harness groups outputs per task and runs five images concurrently", () => {
  const tasks = Array.from({ length: 20 }, (_, index) => ({
    task_id: `task-${index}`,
  }));
  const jobs = tasks.flatMap((task) =>
    Array.from({ length: 7 }, (_, output) => ({ task, output })),
  );
  const batches = buildHarnessBatches(tasks, jobs);

  assert.equal(batches.length, 20);
  assert.deepEqual(
    batches.map((batch) => [batch.tasks.length, batch.jobs.length]),
    Array(20).fill([1, 7]),
  );
  assert.equal(HARNESS_CONCURRENCY, 7);
  assert.equal(HARNESS_IMAGE_CONCURRENCY, 5);
});

test("DeepSWE harness can batch only completed outputs when explicitly requested", () => {
  const tasks = [{ task_id: "task-a" }, { task_id: "task-b" }];
  const jobs = [
    ...Array.from({ length: 5 }, (_, output) => ({ task: tasks[0], output })),
    ...Array.from({ length: 7 }, (_, output) => ({ task: tasks[1], output })),
  ];
  const batches = buildHarnessBatches(tasks, jobs, { allowPartial: true });
  assert.deepEqual(
    batches.map((batch) => batch.jobs.length),
    [5, 7],
  );
});

test("DeepSWE harness accepts the configured output count per task", () => {
  const tasks = [{ task_id: "task-a" }, { task_id: "task-b" }];
  const jobs = tasks.flatMap((task) =>
    Array.from({ length: 3 }, (_, output) => ({ task, output })),
  );
  const batches = buildHarnessBatches(tasks, jobs, {
    expectedOutputsPerTask: 3,
  });
  assert.deepEqual(
    batches.map((batch) => batch.jobs.length),
    [3, 3],
  );
});

test("DeepSWE harness rejects infrastructure failures as completed scores", () => {
  assert.equal(
    validHarnessReport({
      exit_code: 0,
      reward: { reward: 1 },
      model_patch_applied: true,
      model_patch_sha256: "a".repeat(64),
    }),
    true,
  );
  assert.equal(
    validHarnessReport({
      exit_code: 0,
      reward: { reward: 0 },
      model_patch_applied: true,
      model_patch_sha256: "b".repeat(64),
    }),
    true,
  );
  assert.equal(
    validHarnessReport({ exit_code: 2, reward: { reward: -1 } }),
    false,
  );
  assert.equal(
    validHarnessReport({ exit_code: 0, reward: { reward: -1 } }),
    false,
  );
});

test("DeepSWE verifier delegates patch application to the official grader", () => {
  assert.doesNotMatch(VERIFIER_COMMAND, /git apply/);
  assert.match(
    VERIFIER_COMMAND,
    /sed -i.*\/tests\/test\.sh \/tests\/test\.patch/,
  );
  assert.match(VERIFIER_COMMAND, /exec \/bin\/bash \/tests\/test\.sh/);
});
