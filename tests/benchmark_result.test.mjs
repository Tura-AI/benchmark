import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectBenchmarkAttempt } from "../lib/benchmark_result.mjs";

function attempt(result = null) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-benchmark-result-"),
  );
  if (result)
    fs.writeFileSync(
      path.join(directory, "result.json"),
      `${JSON.stringify(result)}\n`,
    );
  return directory;
}

function result(status) {
  return {
    schema_version: "2.0.0",
    run_id: "run",
    task_id: "task",
    agent_id: "agent",
    status,
    score: {
      passed: status === "pass" ? 1 : 0,
      failed: status === "pass" ? 0 : 1,
      total: 1,
      ratio: status === "pass" ? 1 : 0,
      label: status === "pass" ? "1/1" : "0/1",
    },
  };
}

test("a failing result is an evaluation failure even when the runner exits cleanly", () => {
  const inspected = inspectBenchmarkAttempt(attempt(result("fail")), {
    exitCode: 0,
  });
  assert.equal(inspected.status, "fail");
  assert.equal(inspected.failureClass, "evaluation");
  assert.equal(inspected.result.status, "fail");
});

test("a failing result remains an evaluation failure when the runner returns one", () => {
  const inspected = inspectBenchmarkAttempt(attempt(result("fail")), {
    exitCode: 1,
  });
  assert.equal(inspected.failureClass, "evaluation");
});

test("missing and contradictory result contracts are validation failures", () => {
  assert.equal(
    inspectBenchmarkAttempt(attempt(), { exitCode: 0 }).failureClass,
    "validation",
  );
  assert.equal(
    inspectBenchmarkAttempt(attempt(result("pass")), { exitCode: 1 })
      .failureClass,
    "validation",
  );
});

test("a passing result and zero exit code complete successfully", () => {
  const inspected = inspectBenchmarkAttempt(attempt(result("pass")), {
    exitCode: 0,
  });
  assert.equal(inspected.status, "pass");
  assert.equal(inspected.failureClass, null);
});
