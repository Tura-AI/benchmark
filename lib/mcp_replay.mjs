import assert from "node:assert/strict";
import crypto from "node:crypto";

const FAMILY_BUILDERS = {
  github: githubRecord,
  atlassian: atlassianRecord,
  observability: observabilityRecord,
};

export const MCP_REPLAY_SCENARIOS = Object.freeze({
  "answer-dropped": { drop_answer: true },
  "middle-truncation": { truncate_page: 2 },
  "buried-error": { buried_error: true },
  "extra-retrieval": { extra_retrieval: true },
});

export function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

export function createMcpReplayFixture(options = {}) {
  const family = options.family || "github";
  const buildRecord = FAMILY_BUILDERS[family];
  assert(buildRecord, `unsupported MCP fixture family: ${family}`);
  const seed = integer(options.seed, 1729);
  const recordCount = positiveInteger(options.record_count, 137);
  const pageSize = Math.min(positiveInteger(options.page_size, 25), 100);
  const random = seededRandom(seed);
  const records = Array.from({ length: recordCount }, (_, index) =>
    buildRecord(index, random),
  );

  return {
    schema_version: "tura.mcp-replay.fixture.v1",
    family,
    seed,
    page_size: pageSize,
    record_count: records.length,
    initial_state: { revision: 1, status: "open" },
    records,
  };
}

export function fixtureDigest(fixture) {
  return crypto.createHash("sha256").update(stableJson(fixture)).digest("hex");
}

export function verifyByteIdenticalFixture(options) {
  const left = stableJson(createMcpReplayFixture(options));
  const right = stableJson(createMcpReplayFixture(options));
  return {
    identical: left === right,
    bytes: Buffer.byteLength(left),
    sha256: crypto.createHash("sha256").update(left).digest("hex"),
  };
}

export async function replayMcpSession(options = {}) {
  const fixture = options.fixture || createMcpReplayFixture(options);
  const scenario = normalizeScenario(options.scenario);
  const calls = Array.isArray(options.calls)
    ? options.calls
    : defaultCalls(fixture, scenario);
  const retryLimit = integer(options.retry_limit, 2);
  const transientFailures = new Set(options.transient_failures || []);
  const state = structuredClone(fixture.initial_state);
  const metrics = {
    success: true,
    tool_calls: 0,
    turns: 0,
    cached_tokens: 0,
    uncached_tokens: 0,
    retries: 0,
    recovered_failures: 0,
    final_state: null,
  };
  const events = [];
  const attempts = new Map();
  let answer = null;

  for (const call of calls) {
    metrics.turns += 1;
    let result;
    for (;;) {
      const callNumber = metrics.tool_calls + 1;
      metrics.tool_calls = callNumber;
      const attempt = (attempts.get(call.id) || 0) + 1;
      attempts.set(call.id, attempt);
      const shouldFail = transientFailures.has(call.id) && attempt === 1;
      if (shouldFail) {
        events.push({
          call_id: call.id,
          attempt,
          outcome: "transient-error",
          retryable: true,
        });
        if (attempt > retryLimit) {
          metrics.success = false;
          result = { error: "retry limit exhausted" };
          break;
        }
        metrics.retries += 1;
        metrics.recovered_failures += 1;
        continue;
      }

      result = executeFixtureCall(fixture, state, call, scenario);
      const serialized = stableJson(result);
      const tokens = Math.max(1, Math.ceil(serialized.length / 4));
      if (attempt > 1) metrics.cached_tokens += tokens;
      else metrics.uncached_tokens += tokens;
      events.push({ call_id: call.id, attempt, outcome: "ok", result });
      break;
    }
    if (call.capture_answer) answer = result;
  }

  if (scenario.drop_answer) answer = null;
  metrics.success &&= answer !== null;
  metrics.final_state = structuredClone(state);
  return {
    schema_version: "tura.mcp-replay.report.v1",
    fixture: {
      family: fixture.family,
      seed: fixture.seed,
      sha256: fixtureDigest(fixture),
      record_count: fixture.record_count,
      page_size: fixture.page_size,
    },
    scenario,
    events,
    answer,
    metrics,
  };
}

function executeFixtureCall(fixture, state, call, scenario) {
  if (call.tool === "search") {
    const requestedSize = positiveInteger(
      call.arguments?.page_size,
      fixture.page_size,
    );
    const pageSize = Math.min(requestedSize, fixture.page_size, 100);
    const page = positiveInteger(call.arguments?.page, 1);
    const start = (page - 1) * pageSize;
    const effectiveSize = scenario.truncate_page === page ? 1 : pageSize;
    const items = fixture.records.slice(start, start + effectiveSize);
    const response = {
      items,
      page,
      page_size: pageSize,
      next_cursor:
        start + effectiveSize < fixture.records.length
          ? Buffer.from(String(page + 1)).toString("base64url")
          : null,
      state_revision: scenario.stale_read
        ? Math.max(1, state.revision - 1)
        : state.revision,
    };
    if (scenario.buried_error) {
      response.metadata = {
        warnings: [{ code: "PARTIAL_BACKEND_FAILURE", retryable: false }],
      };
    }
    return response;
  }
  if (call.tool === "get") {
    return (
      fixture.records.find((record) => record.id === call.arguments?.id) || null
    );
  }
  if (call.tool === "mutate") {
    state.revision += 1;
    state.status = call.arguments?.status || state.status;
    return { applied: true, state: structuredClone(state) };
  }
  throw new Error(`unsupported replay tool: ${call.tool}`);
}

function defaultCalls(fixture, scenario) {
  const calls = [
    { id: "page-1", tool: "search", arguments: { page: 1 } },
    {
      id: "state-change",
      tool: "mutate",
      arguments: { status: "resolved" },
    },
    {
      id: "page-2",
      tool: "search",
      arguments: { page: 2 },
      capture_answer: true,
    },
  ];
  if (scenario.extra_retrieval) {
    calls.push({
      id: "extra-get",
      tool: "get",
      arguments: { id: fixture.records.at(-1)?.id },
      capture_answer: true,
    });
  }
  return calls;
}

function normalizeScenario(value) {
  if (!value) return {};
  if (typeof value === "string") {
    assert(MCP_REPLAY_SCENARIOS[value], `unknown replay scenario: ${value}`);
    return { name: value, ...MCP_REPLAY_SCENARIOS[value] };
  }
  return structuredClone(value);
}

function githubRecord(index, random) {
  const number = index + 1;
  return {
    id: `I_kwDO${String(number).padStart(8, "0")}`,
    number,
    title: `Sanitized issue ${number}`,
    body: repeatWords(
      "reproduction expected actual",
      18 + Math.floor(random() * 50),
    ),
    state: index % 7 === 0 ? "CLOSED" : "OPEN",
    labels: index % 3 === 0 ? ["bug", "benchmark"] : ["benchmark"],
  };
}

function atlassianRecord(index, random) {
  const number = index + 1;
  return {
    id: `100${String(number).padStart(4, "0")}`,
    key: `SAN-${number}`,
    fields: {
      summary: `Sanitized ticket ${number}`,
      description: repeatWords(
        "context acceptance evidence",
        22 + Math.floor(random() * 60),
      ),
      status: { name: index % 5 === 0 ? "Done" : "In Progress" },
      priority: { name: index % 4 === 0 ? "High" : "Medium" },
    },
  };
}

function observabilityRecord(index, random) {
  const number = index + 1;
  const provider = index % 2 === 0 ? "sentry" : "datadog";
  return {
    id: `${provider}-event-${String(number).padStart(5, "0")}`,
    provider,
    timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, number)).toISOString(),
    level: index % 11 === 0 ? "error" : "info",
    message: repeatWords(
      "sanitized trace event",
      8 + Math.floor(random() * 35),
    ),
    tags: { service: "benchmark-fixture", environment: "replay" },
  };
}

function repeatWords(text, count) {
  return Array.from({ length: count }, () => text).join(" ");
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function positiveInteger(value, fallback) {
  const parsed = integer(value, fallback);
  assert(parsed > 0, `expected a positive integer, received: ${value}`);
  return parsed;
}

function integer(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  assert(Number.isInteger(parsed), `expected an integer, received: ${value}`);
  return parsed;
}
