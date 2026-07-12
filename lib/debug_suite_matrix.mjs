import assert from "node:assert/strict";

export function safeName(value, fallback = "item") {
  return (
    String(value || fallback)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || fallback
  );
}

export function parseStringList(value, fallback = []) {
  const raw = String(value ?? "").trim();
  if (!raw) return [...fallback];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    assert(Array.isArray(parsed), "list JSON must be an array");
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildMatrix(tasks, agentRuns) {
  const jobs = [];
  for (const task of tasks) {
    for (const agentRun of agentRuns) {
      jobs.push({ task, agentRun });
    }
  }
  return jobs;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(
    1,
    Math.min(Number(concurrency) || 1, items.length || 1),
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}
