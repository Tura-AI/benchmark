import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  loadReconciliationInput,
  reconcileObservabilityRun,
} from "../lib/observability_reconciliation.mjs";

const fixtureFile = path.resolve(
  "config/observability-fixtures/tokenmeter.json",
);

test("tokenmeter fixture reconciles provider, agent, and tool records per attempt", () => {
  const input = loadReconciliationInput(fixtureFile);
  const snapshot = JSON.stringify(input);
  const report = reconcileObservabilityRun(input);

  assert.equal(
    JSON.stringify(input),
    snapshot,
    "adapter must not mutate execution input",
  );
  assert.equal(report.execution_modified, false);
  assert.equal(report.claims_execution_savings, false);
  assert.equal(report.attempts.length, 3);
  assert.equal(
    report.attempts[0].differences.observability_vs_provider.input_tokens
      .absolute,
    0,
  );
  assert.equal(
    report.attempts[2].differences.observability_vs_provider.output_tokens
      .absolute,
    -15,
  );
  assert.equal(report.attempts[2].partial_failure, true);
  assert.equal(report.accounting_accurate, false);
});

test("retries, caching, missing and duplicate events are deterministic", () => {
  const input = loadReconciliationInput(fixtureFile);
  const left = reconcileObservabilityRun(input);
  const right = reconcileObservabilityRun(input);

  assert.deepEqual(left, right);
  assert.equal(left.attempts[0].provider.cached_tokens, 40);
  assert.equal(left.attempts[1].retry, true);
  assert.equal(left.event_quality.duplicate_events, 1);
  assert.deepEqual(left.event_quality.missing_events, []);
  assert.equal(left.coverage.by_provider.openai.rate, 1);
  assert.equal(left.coverage.by_provider.anthropic.rate, 1);
});

test("runtime, storage, and crash recovery are measured independently", () => {
  const report = reconcileObservabilityRun(
    loadReconciliationInput(fixtureFile),
  );

  assert.equal(report.overhead.observability_runtime_ms, 120);
  assert.equal(report.overhead.runtime_overhead_rate, 0.012);
  assert.equal(report.overhead.observability_storage_bytes, 2048);
  assert.equal(report.recovery.crashes, 1);
  assert.equal(report.recovery.restarts, 1);
  assert.equal(report.recovery.recoveries, 1);
  assert.equal(report.recovery.complete, true);
});

test("run identifiers cannot be mixed during reconciliation", () => {
  const input = loadReconciliationInput(fixtureFile);
  input.observability[0].run_id = "another-run";
  assert.throws(() => reconcileObservabilityRun(input), /another run_id/);
});
