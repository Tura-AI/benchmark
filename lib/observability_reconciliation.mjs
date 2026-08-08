import assert from "node:assert/strict";
import fs from "node:fs";

const TOKEN_CATEGORIES = [
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "billed_tokens",
];

export function loadReconciliationInput(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function reconcileObservabilityRun(input) {
  validateInput(input);
  const providerRecords = normalizeRecords(input.provider_receipts, "provider");
  const agentRecords = normalizeRecords(input.agent_logs, "agent");
  const rawToolRecords = adaptToolRecords(
    input.observability,
    input.tool?.adapter,
  );
  const duplicateToolEvents = duplicateCount(rawToolRecords);
  const toolRecords = deduplicate(rawToolRecords);
  const attemptIds = [
    ...new Set(providerRecords.map((record) => record.attempt_id)),
  ].sort();

  const attempts = attemptIds.map((attemptId) => {
    const provider = totalsForAttempt(providerRecords, attemptId);
    const agent = totalsForAttempt(agentRecords, attemptId);
    const tool = totalsForAttempt(toolRecords, attemptId);
    return {
      attempt_id: attemptId,
      provider,
      agent,
      observability: tool,
      differences: {
        agent_vs_provider: differences(agent, provider),
        observability_vs_provider: differences(tool, provider),
      },
      retry: recordsFor(providerRecords, attemptId).some(
        (record) => record.retry,
      ),
      partial_failure: recordsFor(toolRecords, attemptId).some(
        (record) => record.partial_failure,
      ),
    };
  });

  const providerUsage = providerRecords.filter(isUsage);
  const observedSourceIds = new Set(
    toolRecords.map((record) => record.source_event_id).filter(Boolean),
  );
  const missingProviderEvents = providerUsage.filter(
    (record) => !observedSourceIds.has(record.event_id),
  );
  const lifecycle = lifecycleRecovery(agentRecords, toolRecords);
  const providerCoverage = coverageBy(
    providerUsage,
    observedSourceIds,
    (record) => record.provider || "unknown",
  );
  const eventTypeCoverage = coverageBy(
    [...providerUsage, ...agentRecords.filter((record) => !isUsage(record))],
    observedSourceIds,
    (record) => record.event_type,
  );
  const providerStorage = byteSize(input.provider_receipts);
  const agentStorage = byteSize(input.agent_logs);
  const toolStorage =
    input.tool?.storage_bytes ?? byteSize(input.observability);
  const executionRuntime = number(input.execution?.runtime_ms);
  const toolRuntime = number(input.tool?.runtime_ms);

  return {
    schema_version: "tura.observability-reconciliation.v1",
    run_id: input.run_id,
    adapter: input.tool?.adapter || "generic",
    execution_modified: false,
    claims_execution_savings: false,
    attempts,
    coverage: {
      by_provider: providerCoverage,
      by_event_type: eventTypeCoverage,
    },
    event_quality: {
      expected_provider_events: providerUsage.length,
      observed_unique_events: toolRecords.length,
      missing_events: missingProviderEvents.map((record) => record.event_id),
      missing_event_rate: rate(
        missingProviderEvents.length,
        providerUsage.length,
      ),
      duplicate_events: duplicateToolEvents,
      duplicate_event_rate: rate(duplicateToolEvents, rawToolRecords.length),
    },
    overhead: {
      execution_runtime_ms: executionRuntime,
      observability_runtime_ms: toolRuntime,
      runtime_overhead_rate: rate(toolRuntime, executionRuntime),
      provider_storage_bytes: providerStorage,
      agent_storage_bytes: agentStorage,
      observability_storage_bytes: toolStorage,
      storage_overhead_rate: rate(toolStorage, providerStorage + agentStorage),
    },
    recovery: lifecycle,
    accounting_accurate: attempts.every((attempt) =>
      TOKEN_CATEGORIES.every(
        (category) =>
          attempt.differences.observability_vs_provider[category].absolute ===
          0,
      ),
    ),
  };
}

function adaptToolRecords(observability, adapter = "generic") {
  assert(Array.isArray(observability), "observability must be an array");
  if (adapter === "generic")
    return normalizeRecords(observability, "observability");
  assert(
    adapter === "tokenmeter",
    `unsupported observability adapter: ${adapter}`,
  );
  return observability.map((record, index) =>
    normalizeRecord(
      {
        event_id: record.id,
        source_event_id: record.receipt_id,
        run_id: record.run_id,
        attempt_id: record.attempt_id,
        provider: record.provider,
        event_type: record.kind || "usage",
        input_tokens: record.usage?.input,
        output_tokens: record.usage?.output,
        cached_tokens: record.usage?.cached,
        billed_tokens: record.usage?.billed,
        retry: record.retry,
        partial_failure: record.partial,
      },
      "observability",
      index,
    ),
  );
}

function normalizeRecords(records, source) {
  assert(Array.isArray(records), `${source} records must be an array`);
  return records.map((record, index) => normalizeRecord(record, source, index));
}

function normalizeRecord(record, source, index) {
  assert(
    record && typeof record === "object",
    `${source} record ${index} is invalid`,
  );
  assert(record.run_id, `${source} record ${index} is missing run_id`);
  assert(record.attempt_id, `${source} record ${index} is missing attempt_id`);
  return {
    event_id: String(record.event_id || `${source}-${index + 1}`),
    source_event_id: record.source_event_id
      ? String(record.source_event_id)
      : null,
    run_id: String(record.run_id),
    attempt_id: String(record.attempt_id),
    provider: record.provider ? String(record.provider) : null,
    event_type: String(record.event_type || "usage"),
    input_tokens: number(record.input_tokens),
    output_tokens: number(record.output_tokens),
    cached_tokens: number(record.cached_tokens),
    billed_tokens: number(record.billed_tokens),
    retry: Boolean(record.retry),
    partial_failure: Boolean(record.partial_failure),
  };
}

function totalsForAttempt(records, attemptId) {
  const totals = Object.fromEntries(
    TOKEN_CATEGORIES.map((category) => [category, 0]),
  );
  for (const record of recordsFor(records, attemptId).filter(isUsage)) {
    for (const category of TOKEN_CATEGORIES)
      totals[category] += record[category];
  }
  return totals;
}

function differences(actual, reference) {
  return Object.fromEntries(
    TOKEN_CATEGORIES.map((category) => {
      const absolute = actual[category] - reference[category];
      return [
        category,
        {
          absolute,
          relative:
            reference[category] === 0 ? null : absolute / reference[category],
        },
      ];
    }),
  );
}

function coverageBy(records, observedIds, keyFor) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFor(record);
    const group = groups.get(key) || { expected: 0, observed: 0, rate: 0 };
    group.expected += 1;
    if (observedIds.has(record.event_id)) group.observed += 1;
    groups.set(key, group);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, group]) => [
        key,
        { ...group, rate: rate(group.observed, group.expected) },
      ]),
  );
}

function lifecycleRecovery(agentRecords, toolRecords) {
  const agentLifecycle = agentRecords.filter((record) => !isUsage(record));
  const observed = new Set(toolRecords.map((record) => record.source_event_id));
  const crashes = agentLifecycle.filter(
    (record) => record.event_type === "crash",
  );
  const restarts = agentLifecycle.filter(
    (record) => record.event_type === "restart",
  );
  const recoveries = agentLifecycle.filter(
    (record) => record.event_type === "recovered",
  );
  return {
    crashes: crashes.length,
    restarts: restarts.length,
    recoveries: recoveries.length,
    observed_lifecycle_events: agentLifecycle.filter((record) =>
      observed.has(record.event_id),
    ).length,
    crash_recovery_rate: rate(recoveries.length, crashes.length),
    complete:
      crashes.length === recoveries.length &&
      agentLifecycle.every((record) => observed.has(record.event_id)),
  };
}

function duplicateCount(records) {
  const seen = new Set();
  let duplicates = 0;
  for (const record of records) {
    if (seen.has(record.event_id)) duplicates += 1;
    else seen.add(record.event_id);
  }
  return duplicates;
}

function deduplicate(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (seen.has(record.event_id)) return false;
    seen.add(record.event_id);
    return true;
  });
}

function recordsFor(records, attemptId) {
  return records.filter((record) => record.attempt_id === attemptId);
}

function isUsage(record) {
  return record.event_type === "usage";
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function number(value) {
  const parsed = Number(value || 0);
  assert(
    Number.isFinite(parsed) && parsed >= 0,
    `invalid non-negative number: ${value}`,
  );
  return parsed;
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function validateInput(input) {
  assert(
    input && typeof input === "object",
    "reconciliation input is required",
  );
  assert(input.run_id, "run_id is required");
  for (const [name, records] of [
    ["provider_receipts", input.provider_receipts],
    ["agent_logs", input.agent_logs],
    ["observability", input.observability],
  ]) {
    assert(Array.isArray(records), `${name} must be an array`);
    for (const record of records) {
      assert.equal(
        record.run_id,
        input.run_id,
        `${name} contains another run_id`,
      );
    }
  }
}
