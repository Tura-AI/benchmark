import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMatrix,
  parseStringList,
  safeName,
} from "../lib/debug_suite_matrix.mjs"

test("debug matrix helpers parse csv and json task lists", () => {
  assert.deepEqual(parseStringList("a,b"), ["a", "b"])
  assert.deepEqual(parseStringList('["a","b"]'), ["a", "b"])
  assert.equal(safeName("SWE/bad id"), "SWE-bad-id")
})

test("debug matrix helpers build task-agent matrices", () => {
  const jobs = buildMatrix(["t1", "t2"], [{ run_id: "a1" }, { run_id: "a2" }])
  assert.deepEqual(jobs.map((job) => `${job.task}:${job.agentRun.run_id}`), ["t1:a1", "t1:a2", "t2:a1", "t2:a2"])
})
