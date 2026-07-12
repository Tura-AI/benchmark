import assert from "node:assert/strict"
import test from "node:test"

import {
  HARNESS_CONCURRENCY,
  VERIFIER_COMMAND,
  buildHarnessBatches,
  validHarnessReport,
} from "../deep_swe/harness.mjs"

test("DeepSWE harness runs one task image at a time with all seven outputs", () => {
  const tasks = Array.from({ length: 20 }, (_, index) => ({ task_id: `task-${index}` }))
  const jobs = tasks.flatMap((task) => Array.from({ length: 7 }, (_, output) => ({ task, output })))
  const batches = buildHarnessBatches(tasks, jobs)

  assert.equal(batches.length, 20)
  assert.deepEqual(batches.map((batch) => [batch.tasks.length, batch.jobs.length]), Array(20).fill([1, 7]))
  assert.equal(HARNESS_CONCURRENCY, 7)
})

test("DeepSWE harness can batch only completed outputs when explicitly requested", () => {
  const tasks = [{ task_id: "task-a" }, { task_id: "task-b" }]
  const jobs = [
    ...Array.from({ length: 5 }, (_, output) => ({ task: tasks[0], output })),
    ...Array.from({ length: 7 }, (_, output) => ({ task: tasks[1], output })),
  ]
  const batches = buildHarnessBatches(tasks, jobs, { allowPartial: true })
  assert.deepEqual(batches.map((batch) => batch.jobs.length), [5, 7])
})

test("DeepSWE harness rejects infrastructure failures as completed scores", () => {
  assert.equal(validHarnessReport({ exit_code: 0, reward: { reward: 1 } }), true)
  assert.equal(validHarnessReport({ exit_code: 0, reward: { reward: 0 } }), true)
  assert.equal(validHarnessReport({ exit_code: 2, reward: { reward: -1 } }), false)
  assert.equal(validHarnessReport({ exit_code: 0, reward: { reward: -1 } }), false)
})

test("DeepSWE verifier command normalizes Windows line endings before execution", () => {
  assert.match(VERIFIER_COMMAND, /sed -i.*\/tests\/test\.sh \/tests\/test\.patch/)
  assert.match(VERIFIER_COMMAND, /exec \/bin\/bash \/tests\/test\.sh/)
})
