import fs from "node:fs";
import path from "node:path";

export function allocateRunDirectory(root, identity) {
  const segments = {
    run_id: safeSegment(identity.runId),
    task: safeSegment(identity.task),
    agent: safeSegment(identity.agent),
    replicate: positiveInteger(identity.replicate, "replicate"),
  };
  const replicateRoot = path.resolve(
    root,
    "runs",
    segments.run_id,
    segments.task,
    segments.agent,
    `replicate-${String(segments.replicate).padStart(2, "0")}`,
  );
  fs.mkdirSync(replicateRoot, { recursive: true });

  for (
    let attempt = positiveInteger(identity.attempt || 1, "attempt");
    ;
    attempt += 1
  ) {
    const runDirectory = path.join(
      replicateRoot,
      `attempt-${String(attempt).padStart(2, "0")}`,
    );
    try {
      fs.mkdirSync(runDirectory);
      const contract = {
        schema: "tura.benchmark.run-directory.v1",
        run_id: identity.runId,
        task: identity.task,
        agent: identity.agent,
        replicate: segments.replicate,
        attempt,
        state: "allocated",
        artifact_path: runDirectory,
        created_at: new Date().toISOString(),
      };
      writeManifest(runDirectory, contract);
      return { runDirectory, attempt, contract };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
}

export function finalizeRunDirectory(runDirectory, state, details = {}) {
  if (!["completed", "quarantined"].includes(state))
    throw new Error(`invalid run directory state: ${state}`);
  const current = JSON.parse(
    fs.readFileSync(path.join(runDirectory, "run-directory.json"), "utf8"),
  );
  const manifest = {
    ...current,
    ...details,
    state,
    artifact_path: path.resolve(runDirectory),
    finished_at: new Date().toISOString(),
  };
  writeManifest(runDirectory, manifest);
  return manifest;
}

function writeManifest(runDirectory, manifest) {
  const target = path.join(runDirectory, "run-directory.json");
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

function safeSegment(value) {
  const segment = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!segment || segment === "." || segment === "..")
    throw new Error(`invalid run directory segment: ${value}`);
  return segment;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`${label} must be a positive integer: ${value}`);
  return number;
}
