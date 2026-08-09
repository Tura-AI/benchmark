import fs from "node:fs";
import path from "node:path";

const RESULT_SCHEMA_VERSION = "2.0.0";
const RESULT_STATUSES = new Set(["pass", "fail"]);

export function inspectBenchmarkAttempt(runDirectory, processResult = {}) {
  const resultPath = path.join(path.resolve(runDirectory), "result.json");
  let result = null;
  let readError = null;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    readError = error;
  }

  const exitCode = processResult.exitCode ?? null;
  const signal = processResult.signal ?? null;
  if (readError) {
    return exitCode === 0
      ? failure(
          "validation",
          `runner exited successfully without a readable result.json: ${readError.message}`,
          { resultPath, exitCode, signal },
        )
      : failure(
          "execution",
          `runner exited with ${exitCode ?? signal ?? "unknown status"} before producing a readable result.json`,
          { resultPath, exitCode, signal },
        );
  }

  const validationError = validateResult(result);
  if (validationError) {
    return failure("validation", validationError, {
      resultPath,
      result,
      exitCode,
      signal,
    });
  }
  if (result.status === "fail") {
    return failure(
      "evaluation",
      `benchmark evaluation failed with score ${result.score?.label || "unknown"}`,
      { resultPath, result, exitCode, signal },
    );
  }
  if (exitCode !== 0) {
    return failure(
      "validation",
      `runner reported a passing result but exited with ${exitCode ?? signal ?? "unknown status"}`,
      { resultPath, result, exitCode, signal },
    );
  }
  return {
    status: "pass",
    failureClass: null,
    message: null,
    resultPath,
    result,
    exitCode,
    signal,
  };
}

function validateResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return "result.json must contain an object";
  if (result.schema_version !== RESULT_SCHEMA_VERSION)
    return `result.json schema_version must be ${RESULT_SCHEMA_VERSION}`;
  if (!RESULT_STATUSES.has(result.status))
    return "result.json status must be pass or fail";
  if (!result.run_id || !result.task_id || !result.agent_id)
    return "result.json is missing run_id, task_id, or agent_id";
  if (!result.score || typeof result.score !== "object")
    return "result.json is missing score";
  return null;
}

function failure(failureClass, message, details) {
  return {
    status: "fail",
    failureClass,
    message,
    ...details,
  };
}
