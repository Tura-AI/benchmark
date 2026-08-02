import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpReplayFixture,
  replayMcpSession,
  stableJson,
  verifyByteIdenticalFixture,
} from "../lib/mcp_replay.mjs";

test("all sanitized fixture families are deterministic and realistically paginated", () => {
  for (const family of ["github", "atlassian", "observability"]) {
    const fixture = createMcpReplayFixture({
      family,
      seed: 42,
      record_count: 137,
      page_size: 25,
    });
    assert.equal(fixture.records.length, 137);
    assert.equal(fixture.page_size, 25);
    assert.equal(
      verifyByteIdenticalFixture({ family, seed: 42 }).identical,
      true,
    );
    assert.equal(
      stableJson(fixture),
      stableJson(
        createMcpReplayFixture({
          family,
          seed: 42,
          record_count: 137,
          page_size: 25,
        }),
      ),
    );
    assert.doesNotMatch(stableJson(fixture), /@[a-z]|https?:\/\//i);
  }
});

test("transient failures retry deterministically and preserve final mutation state", async () => {
  const options = { transient_failures: ["page-1"] };
  const report = await replayMcpSession(options);
  const repeated = await replayMcpSession(options);
  assert.equal(stableJson(report), stableJson(repeated));
  assert.equal(report.metrics.success, true);
  assert.equal(report.metrics.retries, 1);
  assert.equal(report.metrics.recovered_failures, 1);
  assert.equal(report.metrics.tool_calls, 4);
  assert.deepEqual(report.metrics.final_state, {
    revision: 2,
    status: "resolved",
  });
  assert.ok(report.metrics.cached_tokens > 0);
  assert.ok(report.metrics.uncached_tokens > 0);
});

test("failure-case matrix exposes answer, truncation, buried errors, and retrieval costs", async () => {
  const dropped = await replayMcpSession({ scenario: "answer-dropped" });
  const truncated = await replayMcpSession({ scenario: "middle-truncation" });
  const buried = await replayMcpSession({ scenario: "buried-error" });
  const extra = await replayMcpSession({ scenario: "extra-retrieval" });

  assert.equal(dropped.metrics.success, false);
  assert.equal(truncated.answer.items.length, 1);
  assert.equal(
    buried.answer.metadata.warnings[0].code,
    "PARTIAL_BACKEND_FAILURE",
  );
  assert.equal(extra.metrics.tool_calls, 4);
  assert.equal(extra.answer.id, extra.events.at(-1).result.id);
});

test("page-size caps and stale-read injection are explicit", async () => {
  const fixture = createMcpReplayFixture({ page_size: 250 });
  const report = await replayMcpSession({
    fixture,
    scenario: { stale_read: true },
  });
  assert.equal(fixture.page_size, 100);
  assert.equal(report.answer.page_size, 100);
  assert.equal(report.answer.state_revision, 1);
  assert.equal(report.metrics.final_state.revision, 2);
});
