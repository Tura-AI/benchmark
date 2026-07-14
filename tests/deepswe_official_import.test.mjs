import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { selectOfficialTrials } from "../scripts/import_deepswe_official.mjs";

test("official trial selection assigns chronological replicates", () => {
  const rows = [4, 2, 1, 3].map((day) => ({
    trial_name: `task-a__${day}`,
    task_name: "task-a",
    source: "deep-swe",
    eval_scope: "full",
    included_in_score: true,
    model: "gpt-5-6-sol",
    harness: "mini-swe-agent",
    reasoning_effort: "high",
    started_at: `2026-07-0${day}T00:00:00Z`,
  }));
  rows.push(
    ...rows.map((row) => ({
      ...row,
      trial_name: `${row.trial_name}-m`,
      reasoning_effort: "medium",
    })),
  );
  const selected = selectOfficialTrials(rows, ["task-a"]);
  assert.equal(selected.length, 8);
  assert.deepEqual(
    selected
      .filter((row) => row.reasoning_effort === "high")
      .map((row) => row.replicate),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    selected
      .filter((row) => row.reasoning_effort === "high")
      .map((row) => row.trial_name),
    ["task-a__1", "task-a__2", "task-a__3", "task-a__4"],
  );
});

test("committed first-three import is complete and internally consistent", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const auditPath = path.join(
    root,
    "results",
    "debug",
    "deepswe-v1.1-gpt56-sol-mini-swe-agent-first3-audit.json",
  );
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  assert.equal(audit.taskCount, 3);
  assert.equal(audit.runCount, 24);
  assert.equal(audit.reportCount, 8);
  assert.equal(audit.summaryOnlyRuns, 24);
  assert.equal(audit.detailedArtifactImported, 0);

  const trialNames = new Set();
  for (const report of audit.reports) {
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "results", "debug", report.report, "manifest.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.taskCount, 3);
    assert.equal(manifest.runCount, 3);
    assert.equal(manifest.runs.length, 3);
    for (const run of manifest.runs) {
      assert.equal(trialNames.has(run.trialName), false);
      trialNames.add(run.trialName);
    }
  }
  assert.equal(trialNames.size, 24);
});
