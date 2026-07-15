import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditDeepSweTuraPairManifest,
  normalizeRounds,
  readProviderLogCalls,
} from "../scripts/publish_deepswe_tura_pair.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Tura pair publisher requires exactly 20 tasks on 5 shared Docker containers", () => {
  const jobs = Array.from({ length: 20 }, (_, taskIndex) =>
    ["balanced", "direct"].map((agent) => ({
      key: `task-${taskIndex}__${agent}__r1`,
      task: { task_id: `task-${taskIndex}` },
      batch_index: Math.floor(taskIndex / 5) + 1,
      agent,
      reasoning: "high",
      replicate: 1,
      state: "completed",
      scheme_ok: true,
      docker_routing_ok: true,
      harness_state: "completed",
      harness_score: taskIndex % 2,
      round_count: 2,
      total_tokens: 100,
    })),
  ).flat();
  const manifest = {
    schema: "tura.benchmark.deep-swe-matrix.v1",
    benchmark: "datacurve-ai/deep-swe",
    benchmark_version: "v1.1",
    tura_model: "openai/gpt-5.6-sol",
    tura_reasoning: "high",
    shared_tura_task_containers: true,
    concurrency: 5,
    task_batch_size: 5,
    task_batch_count: 4,
    runs_per_task_batch: 10,
    task_batches_are_sequential: true,
    docker_concurrency: 5,
    agent_worker_capacity: 10,
    planned_agent_runs: 40,
    planned_harness_runs: 40,
    phase: "completed",
    jobs,
  };
  assert.deepEqual(auditDeepSweTuraPairManifest(manifest), {
    taskCount: 20,
    agentCount: 2,
    runCount: 40,
    harnessCompleted: 40,
  });
  assert.throws(
    () => auditDeepSweTuraPairManifest({ ...manifest, docker_concurrency: 4 }),
    /4 !== 5/,
  );
  assert.throws(
    () =>
      auditDeepSweTuraPairManifest({
        ...manifest,
        jobs: jobs.map((job, index) =>
          index === 0 ? { ...job, scheme_ok: false } : job,
        ),
      }),
    /false.*true|true.*false/,
  );
});

test("Tura pair result manifest and audit are routed to strict schemas", () => {
  const publisherSource = fs.readFileSync(
    path.join(root, "scripts", "publish_deepswe_tura_pair.mjs"),
    "utf8",
  );
  assert.match(
    publisherSource,
    /commands: toolCalls\.map\(commandFromToolCall\)/,
  );
  assert.match(
    publisherSource,
    /commands,[\s\S]*rounds\.reduce\(\(total, round\) => total \+ round\.toolCalls\.length/,
  );
  const batchSchema = JSON.parse(
    fs.readFileSync(
      path.join(root, "schema", "deepswe-local-batch.schema.json"),
      "utf8",
    ),
  );
  assert.match(
    "report-deepswe-v1.1-gpt56-sol-tura-pair-high-r01",
    new RegExp(batchSchema.properties.id.pattern),
  );
  const auditSchema = JSON.parse(
    fs.readFileSync(
      path.join(root, "schema", "deepswe-tura-pair-audit.schema.json"),
      "utf8",
    ),
  );
  assert.equal(
    auditSchema.properties.schema.const,
    "tura.benchmark.deepswe-tura-pair-normalization-audit.v1",
  );
  const validatorSource = fs.readFileSync(
    path.join(root, "schema", "validate.py"),
    "utf8",
  );
  assert.match(validatorSource, /DeepSWE Tura pair High batch manifests/);
  assert.match(validatorSource, /DeepSWE Tura pair High audits/);
});

test("Tura publisher preserves failed provider calls as zero-usage LLM turns", () => {
  const sourceRun = fs.mkdtempSync(
    path.join(process.cwd(), ".tmp-tura-provider-"),
  );
  try {
    const providerRoot = path.join(sourceRun, "provider-log", "nested");
    fs.mkdirSync(providerRoot, { recursive: true });
    fs.writeFileSync(
      path.join(providerRoot, "0001.json"),
      JSON.stringify({
        type: "llm_call",
        call_id: "successful-call",
        success: true,
        started_at: "2026-01-01T00:00:00Z",
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      }),
    );
    fs.writeFileSync(
      path.join(providerRoot, "0002.json"),
      JSON.stringify({
        type: "llm_call",
        call_id: "failed-call",
        success: false,
        started_at: "2026-01-01T00:00:01Z",
        error: "provider response decode failed",
      }),
    );
    const calls = readProviderLogCalls(sourceRun);
    assert.equal(calls.length, 2);
    const baseRound = (roundId, totalTokens) => ({
      schema: "tura.benchmark.agent-round.v1",
      roundId,
      input: { fullContext: "", messages: [] },
      output: { fullOutput: "", assistantMessage: "", messages: [] },
      messages: [],
      toolCalls: [],
      usage: {
        inputTokens: totalTokens ? 10 : 0,
        cacheInputTokens: 0,
        outputTokens: totalTokens ? 2 : 0,
        reasoningTokens: 0,
        totalTokens,
      },
      metadata: {},
    });
    const rounds = normalizeRounds(
      [baseRound("successful-call", 12), baseRound("failed-call", 999)],
      "fixture-task",
      { publicId: "tura-balanced", mode: "balanced" },
      calls,
    );
    assert.equal(rounds.length, 2);
    assert.equal(rounds[1].metadata.usageUnavailable, true);
    assert.equal(rounds[1].metadata.providerSuccess, false);
    assert.match(rounds[1].metadata.providerError, /decode failed/);
    assert.deepEqual(rounds[1].usage, {
      inputTokens: 0,
      cacheInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    });
    assert.deepEqual(rounds[1].commands, []);
  } finally {
    fs.rmSync(sourceRun, { recursive: true, force: true });
  }
});
