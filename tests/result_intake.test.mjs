import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  importRawSubmission,
  normalizeSubmission,
  publishSubmission,
  submissionStatus,
  validateSubmissionMaterial,
  verifySubmission,
} from "../lib/result_intake.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tura-intake-root-"));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "tura-intake-source-"));
  fs.writeFileSync(path.join(source, "run.log"), "log");
  fs.writeFileSync(path.join(source, "artifact.json"), "{}\n");
  fs.mkdirSync(path.join(source, "canonical_result"));
  fs.writeFileSync(
    path.join(source, "canonical_result", "result.json"),
    "{}\n",
  );
  const manifest = {
    schema: "tura.benchmark.raw-submission.v1",
    submission_id: "external-1",
    state: "raw",
    repository_revision: "abc123",
    commands: ["benchmark run"],
    configuration: { model: "fixture" },
    logs: ["evidence/run.log"],
    artifacts: ["evidence/artifact.json"],
    licensing_constraints: "redistributable",
    contact: "maintainer@example.com",
    created_at: "2026-08-02T00:00:00.000Z",
  };
  return { root, source, manifest };
}

test("raw evidence advances through explicit states before publication", () => {
  const { root, source, manifest } = fixture();
  assert.equal(
    importRawSubmission(root, source, manifest).ci_status,
    "pending-normalization",
  );
  assert.equal(
    normalizeSubmission(root, manifest.submission_id).ci_status,
    "pending-verification",
  );
  assert.equal(
    verifySubmission(root, manifest.submission_id).ci_status,
    "canonical-candidate",
  );
  const published = publishSubmission(
    root,
    manifest.submission_id,
    "results/external/external-1",
  );
  assert.equal(published.canonical, true);
  assert.equal(
    submissionStatus(root, manifest.submission_id).state,
    "published",
  );
  assert.ok(
    fs.existsSync(path.join(root, "results/external/external-1/result.json")),
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "submissions/raw/external-1/evidence/run.log"),
    ),
    "original evidence must be preserved",
  );
});

test("raw and normalized states never enter the canonical result tree", () => {
  const { root, source, manifest } = fixture();
  importRawSubmission(root, source, manifest);
  normalizeSubmission(root, manifest.submission_id);
  assert.equal(fs.existsSync(path.join(root, "results")), false);
  assert.equal(submissionStatus(root, manifest.submission_id).canonical, false);
});

test("missing required material produces actionable validation errors", () => {
  const { root, source, manifest } = fixture();
  manifest.logs = ["evidence/missing.log"];
  importRawSubmission(root, source, manifest);
  const normalized = normalizeSubmission(root, manifest.submission_id);
  const diagnostics = validateSubmissionMaterial(
    normalized.directory,
    normalized.manifest,
  );
  assert.equal(diagnostics.status, "rejected");
  assert.match(
    diagnostics.errors.join("\n"),
    /missing logs file: evidence\/missing\.log/,
  );
  assert.throws(
    () => verifySubmission(root, manifest.submission_id),
    /submission cannot be verified/,
  );
});
