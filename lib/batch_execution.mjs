import fs from "node:fs";
import path from "node:path";

export const FAILURE_CLASSES = [
  "setup",
  "execution",
  "evaluation",
  "validation",
  "publication",
];

export class AttemptFailure extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AttemptFailure";
    this.failureClass = validateFailureClass(
      options.failureClass || "execution",
    );
    this.fatal = options.fatal === true;
    this.artifacts = options.artifacts || null;
  }
}

export async function runIsolatedBatch(jobs, execute, options = {}) {
  const startedAt = new Date().toISOString();
  if (options.preflight) {
    try {
      await options.preflight();
    } catch (error) {
      const failure = failureRecord(error, "setup", true);
      return summarize(jobs, [], startedAt, failure);
    }
  }

  let next = 0;
  let stop = false;
  const attempts = new Array(jobs.length);
  async function worker() {
    while (!stop) {
      const index = next++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      const attemptStartedAt = new Date().toISOString();
      try {
        const result = await execute(job, index);
        attempts[index] = {
          index,
          status: "passed",
          failure_class: null,
          fatal: false,
          started_at: attemptStartedAt,
          finished_at: new Date().toISOString(),
          job,
          result: result ?? null,
        };
      } catch (error) {
        const failure = failureRecord(error);
        attempts[index] = {
          index,
          status: "failed",
          ...failure,
          started_at: attemptStartedAt,
          finished_at: new Date().toISOString(),
          job,
        };
        if (failure.fatal) stop = true;
      }
      await options.onAttemptComplete?.(attempts[index]);
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          positiveInteger(options.concurrency || 1),
          jobs.length,
        ),
      },
      worker,
    ),
  );
  const completed = attempts.filter(Boolean);
  const fatalFailure = completed.find((attempt) => attempt.fatal) || null;
  return summarize(jobs, completed, startedAt, fatalFailure);
}

export function batchExitCode(summary, policy = {}) {
  if (summary.fatal_failure) return 2;
  if (policy.failOnAttemptFailure === false) return 0;
  return summary.failed > 0 ? 1 : 0;
}

export function writeBatchSummary(file, summary) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
  return target;
}

function summarize(jobs, attempts, startedAt, fatalFailure) {
  const byFailureClass = Object.fromEntries(
    FAILURE_CLASSES.map((failureClass) => [failureClass, 0]),
  );
  for (const attempt of attempts) {
    if (attempt.failure_class) byFailureClass[attempt.failure_class] += 1;
  }
  return {
    schema: "tura.benchmark.batch-summary.v1",
    status: fatalFailure
      ? "fatal"
      : attempts.some((attempt) => attempt.status === "failed")
        ? "completed-with-failures"
        : "passed",
    total: jobs.length,
    completed: attempts.length,
    passed: attempts.filter((attempt) => attempt.status === "passed").length,
    failed: attempts.filter((attempt) => attempt.status === "failed").length,
    not_started: jobs.length - attempts.length,
    failures_by_stage: byFailureClass,
    fatal_failure: fatalFailure,
    attempts,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  };
}

function failureRecord(error, fallback = "execution", forceFatal = false) {
  const failureClass = validateFailureClass(error?.failureClass || fallback);
  return {
    failure_class: failureClass,
    fatal: forceFatal || error?.fatal === true,
    error: String(error?.stack || error?.message || error),
    artifacts: error?.artifacts || null,
  };
}

function validateFailureClass(value) {
  if (!FAILURE_CLASSES.includes(value)) {
    throw new Error(`invalid failure class: ${value}`);
  }
  return value;
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`concurrency must be a positive integer: ${value}`);
  return number;
}
