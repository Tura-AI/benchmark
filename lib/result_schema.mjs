import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CURRENT_RESULT_SCHEMA_VERSION = "1.0.0";
export const NEXT_RESULT_SCHEMA_VERSION = "2.0.0";
export const MIGRATION_REVISION = "result-schema-migration-v1";

const SUPPORTED_VERSIONS = new Set([
  CURRENT_RESULT_SCHEMA_VERSION,
  NEXT_RESULT_SCHEMA_VERSION,
]);
const HISTORICAL_SCHEMAS = new Set([
  "tura.benchmark.normalized-summary.v1",
  "tura.business-test.summary.v1",
  "tura.benchmark.raw-agent-summary.v1",
]);
const NEXT_RUNTIME_EVIDENCE = [
  "run_contract",
  "grader",
  "intervention",
  "cohort",
  "state",
  "artifacts",
];

export function resultSchemaState(result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return { state: "rejected", errors: ["result must be a JSON object"] };
  if (!result.schema_version) {
    if (HISTORICAL_SCHEMAS.has(result.schema))
      return {
        state: "canonical-historical",
        schema_version: null,
        source_schema: result.schema,
        errors: [],
      };
    return {
      state: "pending-normalization",
      schema_version: null,
      source_schema: result.schema || null,
      errors: [
        "schema_version is missing and the historical schema is unknown",
      ],
    };
  }
  if (!SUPPORTED_VERSIONS.has(result.schema_version))
    return {
      state: "unsupported-version",
      schema_version: result.schema_version,
      errors: [`unsupported schema_version: ${result.schema_version}`],
    };
  const missing =
    result.schema_version === NEXT_RESULT_SCHEMA_VERSION
      ? NEXT_RUNTIME_EVIDENCE.filter((field) => result[field] == null)
      : [];
  return missing.length
    ? {
        state: "rejected",
        schema_version: result.schema_version,
        errors: missing.map(
          (field) => `runtime evidence cannot be reconstructed: ${field}`,
        ),
      }
    : {
        state: "canonical",
        schema_version: result.schema_version,
        errors: [],
      };
}

export function normalizeResult(result) {
  return migrateResult(result, CURRENT_RESULT_SCHEMA_VERSION);
}

export function migrateResult(
  result,
  targetVersion = NEXT_RESULT_SCHEMA_VERSION,
) {
  assert(
    SUPPORTED_VERSIONS.has(targetVersion),
    `unsupported target schema_version: ${targetVersion}`,
  );
  const sourceState = resultSchemaState(result);
  assert.notEqual(
    sourceState.state,
    "unsupported-version",
    sourceState.errors?.join("; "),
  );
  assert.notEqual(
    sourceState.state,
    "rejected",
    sourceState.errors?.join("; "),
  );
  if (result.schema_version === targetVersion) return structuredClone(result);
  if (targetVersion === NEXT_RESULT_SCHEMA_VERSION) {
    const missing = NEXT_RUNTIME_EVIDENCE.filter(
      (field) => result[field] == null,
    );
    assert(
      missing.length === 0,
      `cannot migrate without observed runtime evidence: ${missing.join(", ")}`,
    );
  }
  const original = structuredClone(result);
  const observedFields = Object.fromEntries(
    Object.keys(original).map((field) => [field, "observed"]),
  );
  return {
    ...original,
    schema_version: targetVersion,
    source_schema_version:
      original.schema_version || `historical:${original.schema || "unknown"}`,
    migration_revision: MIGRATION_REVISION,
    migration: {
      tool_revision: MIGRATION_REVISION,
      source_sha256: sha256Json(original),
      target_schema_version: targetVersion,
    },
    field_provenance: {
      ...observedFields,
      schema_version: "normalized",
      source_schema_version: "normalized",
      migration_revision: "normalized",
      migration: "normalized",
      field_provenance: "normalized",
    },
  };
}

export function migrateResultFile(input, output, options = {}) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  const originalBytes = fs.readFileSync(inputPath);
  const sourceCopy = `${outputPath}.source.json`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  preserveBytes(sourceCopy, originalBytes);
  const original = JSON.parse(originalBytes.toString("utf8"));
  const migrated =
    options.targetVersion === CURRENT_RESULT_SCHEMA_VERSION
      ? normalizeResult(original)
      : migrateResult(original, options.targetVersion);
  const content = `${JSON.stringify(migrated, null, 2)}\n`;
  preserveText(outputPath, content);
  return {
    input: inputPath,
    output: outputPath,
    source_copy: sourceCopy,
    state: resultSchemaState(migrated),
  };
}

function preserveBytes(file, content) {
  if (fs.existsSync(file)) {
    assert(
      fs.readFileSync(file).equals(content),
      `preserved source changed: ${file}`,
    );
    return;
  }
  fs.writeFileSync(file, content, { flag: "wx" });
}

function preserveText(file, content) {
  if (fs.existsSync(file)) {
    assert.equal(
      fs.readFileSync(file, "utf8"),
      content,
      `migration output changed: ${file}`,
    );
    return;
  }
  fs.writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
}

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
