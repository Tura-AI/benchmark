import fs from "node:fs";
import path from "node:path";

const CODEX_TOKEN_USAGE_LOG_SCHEMA = "tura.benchmark.codex-token-usage-log.v1";

export function codexTokenUsageReport(value) {
  const records = Array.isArray(value) ? value : parseJsonl(value);
  const rawEntries = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isCodexTokenUsageUpdate(record));
  const entries = [];
  const seenTotals = new Set();
  for (const entry of rawEntries) {
    const cumulative = entry.record.total_usage;
    if (hasUsage(cumulative)) {
      const key = usageKey(cumulative);
      if (seenTotals.has(key)) continue;
      seenTotals.add(key);
    }
    entries.push(entry);
  }
  const finalCumulative = [...entries]
    .reverse()
    .find(({ record }) => hasUsage(record.total_usage))?.record.total_usage;
  const totals = finalCumulative
    ? normalizedUsage(finalCumulative, entries.length)
    : sumUsage(entries.map(({ record }) => record.usage));
  return {
    schema: CODEX_TOKEN_USAGE_LOG_SCHEMA,
    raw_event_count: rawEntries.length,
    unique_event_count: entries.length,
    duplicate_event_count: rawEntries.length - entries.length,
    totals,
    entries,
  };
}

export function withoutDuplicateCodexTokenUsageRecords(records) {
  const values = Array.isArray(records) ? records : [];
  const report = codexTokenUsageReport(values);
  if (report.duplicate_event_count === 0) return values;
  const keep = new Set(report.entries.map(({ index }) => index));
  return values.filter(
    (record, index) => !isCodexTokenUsageUpdate(record) || keep.has(index),
  );
}

export function writeCodexTokenUsageArtifacts(archiveDirectory, value) {
  const report = codexTokenUsageReport(value);
  const normalizedLogPath = path.join(
    archiveDirectory,
    "codex-token-usage.normalized.jsonl",
  );
  const summaryPath = path.join(
    archiveDirectory,
    "codex-token-usage-summary.json",
  );
  fs.mkdirSync(archiveDirectory, { recursive: true });
  fs.writeFileSync(
    normalizedLogPath,
    report.entries
      .map(({ record, index }) =>
        JSON.stringify({
          schema: CODEX_TOKEN_USAGE_LOG_SCHEMA,
          source_event_index: index + 1,
          type: record.type,
          usage: record.usage,
          total_usage: record.total_usage || null,
        }),
      )
      .join("\n") + (report.entries.length ? "\n" : ""),
    "utf8",
  );
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        schema: CODEX_TOKEN_USAGE_LOG_SCHEMA,
        raw_event_count: report.raw_event_count,
        unique_event_count: report.unique_event_count,
        duplicate_event_count: report.duplicate_event_count,
        totals: report.totals,
        normalized_log_path: normalizedLogPath,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    ...report,
    normalized_log_path: normalizedLogPath,
    summary_path: summaryPath,
  };
}

function isCodexTokenUsageUpdate(record) {
  return (
    record?.type === "thread.token_usage.updated" && hasUsage(record.usage)
  );
}

function normalizedUsage(value, usageEvents) {
  const input = number(value.input_tokens, value.inputTokens, value.input);
  const output = number(value.output_tokens, value.outputTokens, value.output);
  const total =
    number(value.total_tokens, value.totalTokens, value.total) ||
    input + output;
  return {
    usage_events: usageEvents,
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: number(
      value.reasoning_output_tokens,
      value.reasoning_tokens,
      value.reasoningTokens,
    ),
    cached_input_tokens: number(
      value.cached_input_tokens,
      value.cache_read_input_tokens,
      value.cacheInputTokens,
    ),
    cache_write_tokens: number(
      value.cache_write_tokens,
      value.cacheWriteTokens,
    ),
    total_tokens: total,
    latency_ms: number(value.latency_ms, value.latencyMs),
  };
}

function sumUsage(values) {
  const total = normalizedUsage({}, 0);
  for (const value of values) {
    const usage = normalizedUsage(value || {}, 1);
    total.usage_events += 1;
    total.input_tokens += usage.input_tokens;
    total.output_tokens += usage.output_tokens;
    total.reasoning_tokens += usage.reasoning_tokens;
    total.cached_input_tokens += usage.cached_input_tokens;
    total.cache_write_tokens += usage.cache_write_tokens;
    total.total_tokens += usage.total_tokens;
    total.latency_ms += usage.latency_ms;
  }
  return total;
}

function usageKey(value) {
  return JSON.stringify(normalizedUsage(value, 0));
}

function hasUsage(value) {
  return (
    value &&
    typeof value === "object" &&
    [
      value.input_tokens,
      value.inputTokens,
      value.output_tokens,
      value.outputTokens,
      value.total_tokens,
      value.totalTokens,
    ].some((item) => Number(item || 0) > 0)
  );
}

function number(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
