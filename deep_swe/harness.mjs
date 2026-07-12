import assert from "node:assert/strict";

export const HARNESS_CONCURRENCY = 7;
export const VERIFIER_COMMAND =
  "sed -i 's/\\r$//' /tests/test.sh /tests/test.patch && exec /bin/bash /tests/test.sh";

export function buildHarnessBatches(
  tasks,
  jobs,
  { allowPartial = false } = {},
) {
  return tasks.map((task, index) => {
    const batchJobs = jobs.filter((job) => job.task.task_id === task.task_id);
    if (allowPartial) {
      assert(
        batchJobs.length > 0 && batchJobs.length <= 7,
        `task ${task.task_id} must have one to seven completed agent outputs`,
      );
    } else {
      assert.equal(
        batchJobs.length,
        7,
        `task ${task.task_id} must have seven agent outputs`,
      );
    }
    return { index: index + 1, tasks: [task], jobs: batchJobs };
  });
}

export function validHarnessReport(report) {
  return (
    report?.exit_code === 0 && [0, 1].includes(Number(report?.reward?.reward))
  );
}
