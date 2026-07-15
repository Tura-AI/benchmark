import assert from "node:assert/strict";

export const HARNESS_CONCURRENCY = 7;
export const HARNESS_IMAGE_CONCURRENCY = 5;
export const VERIFIER_COMMAND =
  "if [ -s /logs/input/model.patch ]; then git apply --binary --whitespace=nowarn /logs/input/model.patch; fi && sed -i 's/\\r$//' /tests/test.sh /tests/test.patch && exec /bin/bash /tests/test.sh";

export function buildHarnessBatches(
  tasks,
  jobs,
  { allowPartial = false, expectedOutputsPerTask = 7 } = {},
) {
  assert(
    Number.isInteger(expectedOutputsPerTask) && expectedOutputsPerTask > 0,
    "expectedOutputsPerTask must be a positive integer",
  );
  return tasks.map((task, index) => {
    const batchJobs = jobs.filter((job) => job.task.task_id === task.task_id);
    if (allowPartial) {
      assert(
        batchJobs.length > 0 && batchJobs.length <= expectedOutputsPerTask,
        `task ${task.task_id} must have one to ${expectedOutputsPerTask} completed agent outputs`,
      );
    } else {
      assert.equal(
        batchJobs.length,
        expectedOutputsPerTask,
        `task ${task.task_id} must have ${expectedOutputsPerTask} agent outputs`,
      );
    }
    return { index: index + 1, tasks: [task], jobs: batchJobs };
  });
}

export function validHarnessReport(report) {
  return (
    report?.exit_code === 0 &&
    report?.model_patch_applied === true &&
    /^[0-9a-f]{64}$/i.test(String(report?.model_patch_sha256 || "")) &&
    [0, 1].includes(Number(report?.reward?.reward))
  );
}
