import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export const INTAKE_SCHEMA = "tura.benchmark.raw-submission.v1";
export const INTAKE_STATES = ["raw", "normalized", "verified", "published"];

export function importRawSubmission(root, source, manifest) {
  validateManifest(manifest, { expectedState: "raw" });
  const target = statePath(root, "raw", manifest.submission_id);
  createExclusiveDirectory(target);
  const evidence = path.join(target, "evidence");
  fs.cpSync(path.resolve(source), evidence, { recursive: true });
  writeManifest(target, {
    ...manifest,
    state: "raw",
    created_at: manifest.created_at || new Date().toISOString(),
  });
  return statusFor(root, manifest.submission_id, "raw");
}

export function normalizeSubmission(root, submissionId) {
  const source = statePath(root, "raw", submissionId);
  requireState(source, "raw");
  const target = statePath(root, "normalized", submissionId);
  createExclusiveDirectory(target);
  fs.cpSync(source, target, { recursive: true, force: false });
  const candidateSource = path.join(target, "evidence", "canonical_result");
  if (fs.existsSync(candidateSource))
    fs.cpSync(candidateSource, path.join(target, "canonical_result"), {
      recursive: true,
      force: false,
    });
  const manifest = readManifest(target);
  writeManifest(target, {
    ...manifest,
    state: "normalized",
    normalized_at: new Date().toISOString(),
    source_evidence: path.relative(target, source) || source,
  });
  return statusFor(root, submissionId, "normalized");
}

export function verifySubmission(root, submissionId) {
  const source = statePath(root, "normalized", submissionId);
  const manifest = requireState(source, "normalized");
  const diagnostics = validateSubmissionMaterial(source, manifest);
  assert(
    diagnostics.errors.length === 0,
    `submission cannot be verified:\n- ${diagnostics.errors.join("\n- ")}`,
  );
  const target = statePath(root, "verified", submissionId);
  createExclusiveDirectory(target);
  fs.cpSync(source, target, { recursive: true, force: false });
  writeManifest(target, {
    ...manifest,
    state: "verified",
    verified_at: new Date().toISOString(),
    validation: diagnostics,
  });
  return statusFor(root, submissionId, "verified");
}

export function publishSubmission(root, submissionId, destination) {
  const source = statePath(root, "verified", submissionId);
  const manifest = requireState(source, "verified");
  const candidate = path.join(source, "canonical_result");
  assert(
    fs.statSync(candidate).isDirectory(),
    `missing canonical_result directory: ${candidate}`,
  );
  const resultsRoot = path.resolve(root, "results");
  const targetResult = path.resolve(root, destination);
  assertInside(resultsRoot, targetResult, "published result");
  createExclusiveDirectory(targetResult);
  fs.cpSync(candidate, targetResult, { recursive: true, force: false });

  const target = statePath(root, "published", submissionId);
  createExclusiveDirectory(target);
  fs.cpSync(source, target, { recursive: true, force: false });
  writeManifest(target, {
    ...manifest,
    state: "published",
    published_at: new Date().toISOString(),
    canonical_result_path: targetResult,
  });
  return statusFor(root, submissionId, "published");
}

export function submissionStatus(root, submissionId) {
  for (const state of [...INTAKE_STATES].reverse()) {
    const target = statePath(root, state, submissionId);
    if (fs.existsSync(path.join(target, "manifest.json")))
      return statusFor(root, submissionId, state);
  }
  throw new Error(`unknown submission: ${submissionId}`);
}

export function validateSubmissionMaterial(
  directory,
  manifest = readManifest(directory),
) {
  validateManifest(manifest);
  const errors = [];
  for (const field of ["logs", "artifacts"]) {
    if (!manifest[field].length)
      errors.push(`${field} must list at least one path`);
    for (const relative of manifest[field]) {
      const target = path.resolve(directory, relative);
      try {
        assertInside(path.resolve(directory), target, field);
      } catch (error) {
        errors.push(String(error.message || error));
        continue;
      }
      if (!fs.existsSync(target))
        errors.push(`missing ${field} file: ${relative}`);
    }
  }
  if (!fs.existsSync(path.join(directory, "canonical_result")))
    errors.push("missing normalized canonical_result directory");
  return {
    status: errors.length ? "rejected" : "canonical-candidate",
    errors,
  };
}

export function validateManifest(manifest, options = {}) {
  assert.equal(
    manifest?.schema,
    INTAKE_SCHEMA,
    "unsupported raw manifest schema",
  );
  assert.match(String(manifest.submission_id || ""), /^[A-Za-z0-9._-]+$/);
  assert(
    INTAKE_STATES.includes(manifest.state),
    `invalid intake state: ${manifest.state}`,
  );
  if (options.expectedState)
    assert.equal(manifest.state, options.expectedState);
  for (const field of [
    "repository_revision",
    "licensing_constraints",
    "contact",
  ])
    assert(String(manifest[field] || "").trim(), `${field} is required`);
  assert(Array.isArray(manifest.commands), "commands must be an array");
  assert(manifest.configuration && typeof manifest.configuration === "object");
  assert(Array.isArray(manifest.logs), "logs must be an array");
  assert(Array.isArray(manifest.artifacts), "artifacts must be an array");
  return manifest;
}

function statusFor(root, submissionId, state) {
  const directory = statePath(root, state, submissionId);
  const manifest = readManifest(directory);
  const labels = {
    raw: "pending-normalization",
    normalized: "pending-verification",
    verified: "canonical-candidate",
    published: "canonical",
  };
  return {
    submission_id: submissionId,
    state,
    ci_status: labels[state],
    canonical: state === "published",
    directory,
    manifest,
  };
}

function statePath(root, state, submissionId) {
  assert(INTAKE_STATES.includes(state));
  assert.match(String(submissionId), /^[A-Za-z0-9._-]+$/);
  return path.resolve(root, "submissions", state, submissionId);
}

function requireState(directory, expected) {
  assert(
    fs.existsSync(directory),
    `missing ${expected} submission: ${directory}`,
  );
  const manifest = readManifest(directory);
  validateManifest(manifest, { expectedState: expected });
  return manifest;
}

function readManifest(directory) {
  return JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function createExclusiveDirectory(directory) {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
}

function assertInside(root, target, label) {
  const relative = path.relative(root, target);
  assert(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${label} escapes ${root}: ${target}`,
  );
}
