import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AttemptFailure,
  batchExitCode,
  runIsolatedBatch,
  writeBatchSummary,
} from "../lib/batch_execution.mjs";

test("non-fatal execution and validation failures do not abort the matrix", async () => {
  const jobs = ["ok-1", "execution-failure", "validation-failure", "ok-2"];
  const visited = [];
  const summary = await runIsolatedBatch(
    jobs,
    async (job) => {
      visited.push(job);
      if (job === "execution-failure")
        throw new AttemptFailure("agent exited", {
          failureClass: "execution",
          artifacts: { log: "execution.log" },
        });
      if (job === "validation-failure")
        throw new AttemptFailure("assertion failed", {
          failureClass: "validation",
          artifacts: { log: "validation.log" },
        });
      return { artifact: `${job}.json` };
    },
    { concurrency: 2 },
  );

  assert.deepEqual(visited.sort(), [...jobs].sort());
  assert.equal(summary.completed, 4);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 2);
  assert.equal(summary.not_started, 0);
  assert.equal(summary.failures_by_stage.execution, 1);
  assert.equal(summary.failures_by_stage.validation, 1);
  assert.equal(summary.attempts[1].artifacts.log, "execution.log");
  assert.equal(summary.attempts[2].artifacts.log, "validation.log");
  assert.equal(batchExitCode(summary), 1);
  assert.equal(batchExitCode(summary, { failOnAttemptFailure: false }), 0);
});

test("fatal preflight stops the batch before any attempt starts", async () => {
  let executions = 0;
  const summary = await runIsolatedBatch(
    ["would-spend", "also-would-spend"],
    async () => {
      executions += 1;
    },
    {
      preflight() {
        throw new AttemptFailure("missing provider credential", {
          failureClass: "setup",
          fatal: true,
        });
      },
    },
  );

  assert.equal(executions, 0);
  assert.equal(summary.status, "fatal");
  assert.equal(summary.completed, 0);
  assert.equal(summary.not_started, 2);
  assert.equal(batchExitCode(summary), 2);
});

test("batch summaries are written atomically with per-stage failures", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tura-batch-summary-"));
  const file = path.join(root, "nested", "summary.json");
  writeBatchSummary(file, {
    schema: "tura.benchmark.batch-summary.v1",
    failures_by_stage: { evaluation: 1 },
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    schema: "tura.benchmark.batch-summary.v1",
    failures_by_stage: { evaluation: 1 },
  });
});
