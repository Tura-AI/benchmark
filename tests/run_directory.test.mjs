import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  allocateRunDirectory,
  finalizeRunDirectory,
} from "../lib/run_directory.mjs";

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tura-run-directory-"));
}

const execFileAsync = promisify(execFile);

test("parallel agents and replicates never share writable paths", async () => {
  const target = root();
  const identities = [
    { runId: "run-1", task: "task", agent: "a", replicate: 1 },
    { runId: "run-1", task: "task", agent: "b", replicate: 1 },
    { runId: "run-1", task: "task", agent: "a", replicate: 2 },
  ];
  const allocations = await Promise.all(
    identities.map(async (identity) => allocateRunDirectory(target, identity)),
  );
  assert.equal(new Set(allocations.map((item) => item.runDirectory)).size, 3);
  for (const allocation of allocations) {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(allocation.runDirectory, "run-directory.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.artifact_path, allocation.runDirectory);
    assert.equal(manifest.state, "allocated");
  }
});

test("retries atomically allocate distinct attempt directories", async () => {
  const target = root();
  const identity = {
    runId: "same-run",
    task: "same-task",
    agent: "same-agent",
    replicate: 1,
  };
  const moduleUrl = pathToFileURL(path.resolve("lib/run_directory.mjs")).href;
  const script = `
    import { allocateRunDirectory } from ${JSON.stringify(moduleUrl)};
    const result = allocateRunDirectory(${JSON.stringify(target)}, ${JSON.stringify(identity)});
    console.log(JSON.stringify(result));
  `;
  const allocations = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const result = await execFileAsync(process.execPath, [
        "--input-type=module",
        "--eval",
        script,
      ]);
      return JSON.parse(result.stdout);
    }),
  );
  assert.deepEqual(
    allocations.map((item) => item.attempt).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(new Set(allocations.map((item) => item.runDirectory)).size, 8);
});

test("failed attempts retain a quarantine manifest", () => {
  const allocation = allocateRunDirectory(root(), {
    runId: "run",
    task: "task",
    agent: "agent",
    replicate: 1,
  });
  fs.writeFileSync(path.join(allocation.runDirectory, "runner.log"), "failure");
  const manifest = finalizeRunDirectory(
    allocation.runDirectory,
    "quarantined",
    { failure_class: "validation" },
  );
  assert.equal(manifest.state, "quarantined");
  assert.equal(manifest.failure_class, "validation");
  assert.equal(
    fs.readFileSync(path.join(allocation.runDirectory, "runner.log"), "utf8"),
    "failure",
  );
});
