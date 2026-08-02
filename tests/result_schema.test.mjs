import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CURRENT_RESULT_SCHEMA_VERSION,
  migrateResult,
  migrateResultFile,
  normalizeResult,
  resultSchemaState,
} from "../lib/result_schema.mjs";

const historical = {
  schema: "tura.benchmark.normalized-summary.v1",
  runId: "run-1",
  model: "observed-model",
};

test("supported historical results remain canonical", () => {
  assert.deepEqual(resultSchemaState(historical), {
    state: "canonical-historical",
    schema_version: null,
    source_schema: historical.schema,
    errors: [],
  });
});

test("normalization is deterministic and idempotent", () => {
  const first = normalizeResult(historical);
  const second = normalizeResult(first);
  assert.deepEqual(second, first);
  assert.equal(first.schema_version, CURRENT_RESULT_SCHEMA_VERSION);
  assert.equal(first.source_schema_version, `historical:${historical.schema}`);
  assert.equal(first.field_provenance.model, "observed");
  assert.equal(first.field_provenance.schema_version, "normalized");
  assert.match(first.migration.source_sha256, /^[0-9a-f]{64}$/);
});

test("vNext migration refuses to fabricate unavailable runtime evidence", () => {
  assert.throws(
    () => migrateResult(historical, "2.0.0"),
    /cannot migrate without observed runtime evidence: run_contract, grader, intervention, cohort, state, artifacts/,
  );
  const observed = {
    ...historical,
    run_contract: {},
    grader: {},
    intervention: {},
    cohort: {},
    state: "verified",
    artifacts: [],
  };
  const migrated = migrateResult(observed, "2.0.0");
  assert.equal(resultSchemaState(migrated).state, "canonical");
  assert.equal(migrated.field_provenance.run_contract, "observed");
});

test("file migration preserves byte-identical source and stable output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tura-schema-migration-"));
  const input = path.join(root, "legacy.json");
  const output = path.join(root, "normalized", "result.json");
  const bytes = `${JSON.stringify(historical)}\n`;
  fs.writeFileSync(input, bytes);
  const first = migrateResultFile(input, output, {
    targetVersion: CURRENT_RESULT_SCHEMA_VERSION,
  });
  const second = migrateResultFile(input, output, {
    targetVersion: CURRENT_RESULT_SCHEMA_VERSION,
  });
  assert.deepEqual(second, first);
  assert.equal(fs.readFileSync(first.source_copy, "utf8"), bytes);
});

test("unsupported versions have an explicit CI state", () => {
  const state = resultSchemaState({ schema_version: "99.0.0" });
  assert.equal(state.state, "unsupported-version");
  assert.match(state.errors[0], /99\.0\.0/);
});
