import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  WORKSPACE_MANIFEST,
  captureChangedWorkspace,
  patchFileChanges,
  recoverDebugWorkspaces,
} from "../lib/debug_workspace_recovery.mjs";

test("patchFileChanges identifies additions, modifications, and deletions", () => {
  const patch = [
    "diff --git a/old.txt b/old.txt",
    "--- a/old.txt",
    "+++ /dev/null",
    "diff --git a/existing.txt b/existing.txt",
    "--- a/existing.txt",
    "+++ b/existing.txt",
    "diff --git a/new.txt b/new.txt",
    "--- /dev/null",
    "+++ b/new.txt",
  ].join("\n");
  assert.deepEqual(patchFileChanges(patch), [
    { oldPath: "old.txt", newPath: null },
    { oldPath: "existing.txt", newPath: "existing.txt" },
    { oldPath: null, newPath: "new.txt" },
  ]);
});

test("captureChangedWorkspace always creates a sparse workspace manifest", () => {
  const root = temporaryDirectory();
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  fs.mkdirSync(path.join(source, "nested"), { recursive: true });
  fs.writeFileSync(path.join(source, "nested", "changed.txt"), "after\n");
  const patch = [
    "diff --git a/nested/changed.txt b/nested/changed.txt",
    "--- a/nested/changed.txt",
    "+++ b/nested/changed.txt",
    "diff --git a/deleted.txt b/deleted.txt",
    "--- a/deleted.txt",
    "+++ /dev/null",
    "",
  ].join("\n");
  const manifest = captureChangedWorkspace({
    sourceWorkspace: source,
    outputDirectory: output,
    patchText: patch,
  });
  assert.equal(
    fs.readFileSync(path.join(output, "nested", "changed.txt"), "utf8"),
    "after\n",
  );
  assert.deepEqual(manifest.included, ["nested/changed.txt"]);
  assert.deepEqual(manifest.deleted, ["deleted.txt"]);
  assert.ok(fs.existsSync(path.join(output, WORKSPACE_MANIFEST)));
});

test("recoverDebugWorkspaces rebuilds and byte-verifies a workspace from raw", () => {
  const root = temporaryDirectory();
  const repository = path.join(root, "repository");
  fs.mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.name", "Benchmark Test"]);
  git(repository, ["config", "user.email", "benchmark@example.com"]);
  git(repository, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(repository, "changed.txt"), "before\n");
  fs.writeFileSync(path.join(repository, "deleted.txt"), "delete me\n");
  fs.writeFileSync(path.join(repository, "untouched.txt"), "untouched\n");
  git(repository, ["add", "-A"]);
  git(repository, ["commit", "-qm", "base"]);
  const baseCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
  fs.writeFileSync(path.join(repository, "changed.txt"), "after\n");
  fs.writeFileSync(path.join(repository, "added.txt"), "added\n");
  fs.rmSync(path.join(repository, "deleted.txt"));
  git(repository, ["add", "-A"]);
  const patch = git(repository, [
    "diff",
    "--cached",
    "--binary",
    "HEAD",
  ]).stdout;

  const rawRoot = path.join(root, "raw");
  const batch = "fixture-batch";
  const rawBatch = path.join(rawRoot, "deep-swe-fixture", batch);
  const rawRun = path.join(rawBatch, "runs", "fixture-task", "codex-cli-r1");
  fs.mkdirSync(rawRun, { recursive: true });
  writeJson(path.join(rawBatch, "manifest.json"), {
    schema: "tura.benchmark.deep-swe-matrix.v1",
    run_id: batch,
    jobs: [],
  });
  writeJson(path.join(rawBatch, "selection.json"), {
    schema: "tura.benchmark.deep-swe-selection.v1",
    tasks: [
      {
        task_id: "fixture-task",
        repository_url: repository,
        base_commit_hash: baseCommit,
      },
    ],
  });
  fs.writeFileSync(path.join(rawRun, "model.patch"), patch);
  writeJson(path.join(rawRun, "agent-summary.json"), {
    schema: "tura.benchmark.deep-swe-agent-summary.v1",
    repo: repository,
    patch: { changed_files: ["changed.txt", "added.txt", "deleted.txt"] },
  });

  const resultsRoot = path.join(root, "results", "debug");
  const publishedRun = path.join(
    resultsRoot,
    "fixture-report",
    "fixture-task",
    "codex-cli",
    "fixture-task-codex-cli-run-01",
  );
  fs.mkdirSync(path.join(publishedRun, "metadata", "contracts"), {
    recursive: true,
  });
  writeJson(path.join(publishedRun, "metadata", "summary.json"), {
    schema: "tura.benchmark.normalized-summary.v1",
    runId: "fixture-task-codex-cli-run-01",
    taskId: "fixture-task",
    sourceBatch: batch,
  });
  writeJson(
    path.join(publishedRun, "metadata", "contracts", "contract-manifest.json"),
    {
      schema: "tura.benchmark.contract-manifest.v1",
      runId: "fixture-task-codex-cli-run-01",
      files: {},
      naming: { runDirectory: "fixture", roundFile: "fixture" },
    },
  );

  const result = recoverDebugWorkspaces({ rawRoot, resultsRoot });
  assert.equal(result.recovered, 1);
  const workspace = path.join(publishedRun, "workspace");
  assert.equal(
    fs.readFileSync(path.join(workspace, "changed.txt"), "utf8"),
    "after\n",
  );
  assert.equal(
    fs.readFileSync(path.join(workspace, "added.txt"), "utf8"),
    "added\n",
  );
  assert.ok(!fs.existsSync(path.join(workspace, "deleted.txt")));
  assert.ok(!fs.existsSync(path.join(workspace, "untouched.txt")));
  assert.deepEqual(
    fs.readFileSync(
      path.join(publishedRun, "metadata", "contracts", "git-diff.patch"),
    ),
    Buffer.from(patch),
  );
  const check = recoverDebugWorkspaces({ rawRoot, resultsRoot, check: true });
  assert.equal(check.ok, true);
});

test("recoverDebugWorkspaces derives a missing Tura patch from a retained raw workspace", () => {
  const root = temporaryDirectory();
  const rawRoot = path.join(root, "raw");
  const batch = "retained-workspace-batch";
  const rawBatch = path.join(rawRoot, "deep-swe-fixture", batch);
  const retained = path.join(rawBatch, "_workspaces", "retained-tura");
  fs.mkdirSync(retained, { recursive: true });
  git(retained, ["init", "-q"]);
  git(retained, ["config", "user.name", "Benchmark Test"]);
  git(retained, ["config", "user.email", "benchmark@example.com"]);
  git(retained, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(retained, "changed.txt"), "before\n");
  git(retained, ["add", "-A"]);
  git(retained, ["commit", "-qm", "base"]);
  const baseCommit = git(retained, ["rev-parse", "HEAD"]).stdout.trim();
  fs.writeFileSync(path.join(retained, "changed.txt"), "after\n");
  fs.writeFileSync(path.join(retained, "added.txt"), "from tura\n");

  writeJson(path.join(rawBatch, "manifest.json"), {
    schema: "tura.benchmark.deep-swe-matrix.v1",
    run_id: batch,
    jobs: [],
  });
  writeJson(path.join(rawBatch, "selection.json"), {
    schema: "tura.benchmark.deep-swe-selection.v1",
    tasks: [
      {
        task_id: "fixture-task",
        repository_url: retained,
        base_commit_hash: baseCommit,
      },
    ],
  });

  const resultsRoot = path.join(root, "results", "debug");
  const publishedRun = path.join(
    resultsRoot,
    "fixture-report",
    "fixture-task",
    "tura-balanced",
    "fixture-task-tura-balanced-run-01",
  );
  fs.mkdirSync(path.join(publishedRun, "metadata", "contracts"), {
    recursive: true,
  });
  writeJson(path.join(publishedRun, "metadata", "summary.json"), {
    schema: "tura.benchmark.normalized-summary.v1",
    runId: "fixture-task-tura-balanced-run-01",
    taskId: "fixture-task",
    sourceBatch: batch,
  });
  writeJson(path.join(publishedRun, "metadata", "source-invocation.json"), {
    agent: "tura-balanced",
    cwd: retained,
    args: ["exec", "bash", "--cwd", retained],
  });
  writeJson(
    path.join(publishedRun, "metadata", "contracts", "contract-manifest.json"),
    {
      schema: "tura.benchmark.contract-manifest.v1",
      runId: "fixture-task-tura-balanced-run-01",
      files: {},
      naming: { runDirectory: "fixture", roundFile: "fixture" },
    },
  );

  const result = recoverDebugWorkspaces({ rawRoot, resultsRoot });
  assert.equal(result.recovered, 1);
  assert.equal(result.runs[0].patchSource, "retained-raw-git-workspace");
  const workspace = path.join(publishedRun, "workspace");
  assert.equal(
    fs.readFileSync(path.join(workspace, "changed.txt"), "utf8"),
    "after\n",
  );
  assert.equal(
    fs.readFileSync(path.join(workspace, "added.txt"), "utf8"),
    "from tura\n",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(workspace, WORKSPACE_MANIFEST), "utf8"),
  );
  assert.equal(manifest.originalPatchAvailable, false);
  assert.equal(manifest.diffVerifiedByteForByte, false);
  assert.equal(manifest.diffVerifiedAgainstRetainedWorkspace, true);
  const check = recoverDebugWorkspaces({ rawRoot, resultsRoot, check: true });
  assert.equal(check.ok, true);
});

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tura-debug-recovery-test-"));
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
