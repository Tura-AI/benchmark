import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const WORKSPACE_MANIFEST = ".benchmark-workspace.json";

export function patchFileChanges(patchText) {
  const changes = [];
  let current = null;
  for (const line of String(patchText).split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (current) changes.push(current);
      current = { oldPath: null, newPath: null };
    } else if (current && line.startsWith("--- ")) {
      current.oldPath = patchHeaderPath(line.slice(4), "a/");
    } else if (current && line.startsWith("+++ ")) {
      current.newPath = patchHeaderPath(line.slice(4), "b/");
    }
  }
  if (current) changes.push(current);
  return changes.filter((change) => change.oldPath || change.newPath);
}

export function captureChangedWorkspace({
  sourceWorkspace,
  outputDirectory,
  patchText,
  provenance = {},
}) {
  const changes = patchFileChanges(patchText);
  const included = [
    ...new Set(changes.map((item) => item.newPath).filter(Boolean)),
  ];
  const deleted = [
    ...new Set(
      changes
        .filter((item) => item.oldPath && !item.newPath)
        .map((item) => item.oldPath),
    ),
  ];
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const relative of included) {
    const source = safeJoin(sourceWorkspace, relative);
    if (!fs.existsSync(source)) {
      throw new Error(`patch output is missing from workspace: ${source}`);
    }
    const target = safeJoin(outputDirectory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
  }
  const manifest = {
    schema: "tura.benchmark.changed-workspace.v1",
    layout: "changed-files",
    completeRepository: false,
    patchSha256: sha256(patchText),
    included,
    deleted,
    ...provenance,
  };
  writeJson(path.join(outputDirectory, WORKSPACE_MANIFEST), manifest);
  return manifest;
}

export function recoverDebugWorkspaces(options) {
  const rawRoot = path.resolve(options.rawRoot);
  const resultsRoot = path.resolve(options.resultsRoot);
  const agents = new Set(
    options.agents || ["codex-cli", "tura-balanced", "tura-direct"],
  );
  const reports = new Set(options.reports || []);
  const tasks = new Set(options.tasks || []);
  const manifests = discoverRawManifests(rawRoot);
  const runs = discoverPublishedRuns(resultsRoot).filter((run) => {
    if (!agents.has("*") && !agents.has(run.agent)) return false;
    if (reports.size && !reports.has(run.report)) return false;
    if (tasks.size && !tasks.has(run.summary.taskId)) return false;
    return true;
  });
  assert(runs.length > 0, `no matching debug runs under ${resultsRoot}`);

  const records = runs.map((run) => resolveRecord(run, manifests));
  if (options.check) return checkRecords(records);
  if (options.dryRun) {
    return {
      selected: records.length,
      recovered: 0,
      existing: records.filter((record) => validWorkspace(record)).length,
      planned: records.map(publicRecord),
    };
  }

  const cacheRoot = path.resolve(
    options.cacheRoot ||
      path.join(rawRoot, "_cache", "debug-workspace-recovery"),
  );
  const objectDirectories = lazyObjectDirectories(rawRoot, manifests);
  const result = {
    selected: records.length,
    recovered: 0,
    existing: 0,
    runs: [],
  };
  for (const record of records) {
    if (validWorkspace(record) && !options.overwrite) {
      ensurePublishedDiff(record);
      result.existing += 1;
      result.runs.push({ ...publicRecord(record), status: "existing" });
      continue;
    }
    if (fs.existsSync(record.workspace) && !options.overwrite) {
      throw new Error(
        `workspace exists without matching recovery metadata; pass --overwrite: ${record.workspace}`,
      );
    }
    ensurePublishedDiff(record);
    const rawWorkspace = path.join(record.rawAgentDirectory, "workspace");
    let recovery;
    if (validRawWorkspace(rawWorkspace, record.patchSha256)) {
      fs.rmSync(record.workspace, { recursive: true, force: true });
      fs.cpSync(rawWorkspace, record.workspace, {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
      });
      recovery = readJson(path.join(record.workspace, WORKSPACE_MANIFEST));
      recovery.recoverySource = "raw-workspace";
    } else if (record.retainedWorkspace) {
      recovery = captureChangedWorkspace({
        sourceWorkspace: record.retainedWorkspace,
        outputDirectory: record.workspace,
        patchText: record.patchText,
        provenance: {
          agent: record.agent,
          taskId: record.summary.taskId,
          runId: record.runId,
          sourceBatch: record.rawBatch,
          sourceRun: relativeSlash(
            record.rawManifestRoot,
            record.retainedWorkspace,
          ),
          repository: record.repository,
          baseCommit: record.baseCommit,
          recoverySource: record.patchSource,
          originalPatchAvailable: false,
          diffVerifiedByteForByte: false,
          diffVerifiedAgainstRetainedWorkspace: true,
        },
      });
    } else {
      recovery = reconstructChangedWorkspace(record, {
        cacheRoot,
        offline: Boolean(options.offline),
        objectDirectories: objectDirectories(),
      });
    }
    updatePublishedMetadata(record, recovery);
    result.recovered += 1;
    result.runs.push({ ...publicRecord(record), status: "recovered" });
  }
  return result;
}

function reconstructChangedWorkspace(record, options) {
  const mirror = ensureMirror(record, options);
  primeBaseBlobs(record, mirror);
  const temporaryRoot = path.join(options.cacheRoot, "_tmp");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, "run-"));
  try {
    initializeRecoveryRepository(temporary, [path.join(mirror, "objects")]);
    let fakeIndex = path.join(temporary, ".git", "fake-index");
    let built = runGit(
      temporary,
      ["apply", `--build-fake-ancestor=${fakeIndex}`, record.rawPatch],
      { allowFailure: true },
    );
    if (built.status !== 0) {
      const extra = findObjectStores(
        oldBlobPrefixes(record.patchText),
        options.objectDirectories,
      );
      initializeRecoveryRepository(temporary, [
        path.join(mirror, "objects"),
        ...extra,
      ]);
      fakeIndex = path.join(temporary, ".git", "fake-index");
      built = runGit(
        temporary,
        ["apply", `--build-fake-ancestor=${fakeIndex}`, record.rawPatch],
        { allowFailure: true },
      );
    }
    if (built.status !== 0) {
      throw new Error(
        `cannot reconstruct patch baseline for ${record.runId}: ${built.stderr.trim()}`,
      );
    }
    const indexEnv = { GIT_INDEX_FILE: fakeIndex };
    runGit(temporary, ["checkout-index", "-a"], { env: indexEnv });
    runGit(temporary, ["update-index", "--refresh"], { env: indexEnv });
    const baselineTree = runGit(temporary, ["write-tree"], {
      env: indexEnv,
    }).stdout.trim();
    runGit(temporary, ["apply", "--index", "--binary", record.rawPatch], {
      env: indexEnv,
    });
    const regenerated = runGit(
      temporary,
      [
        "-c",
        `core.abbrev=${patchAbbrevLength(record.patchText)}`,
        "diff",
        "--cached",
        "--binary",
        baselineTree,
      ],
      { env: indexEnv, encoding: null },
    ).stdout;
    if (!Buffer.from(regenerated).equals(record.patchBuffer)) {
      const regeneratedBuffer = Buffer.from(regenerated);
      const mismatch = firstBufferDifference(
        record.patchBuffer,
        regeneratedBuffer,
      );
      throw new Error(
        `regenerated diff differs from raw patch for ${record.runId}: byte ${mismatch}, raw=${record.patchBuffer.length}, regenerated=${regeneratedBuffer.length}`,
      );
    }
    const nameStatus = runGit(
      temporary,
      ["diff", "--cached", "--name-status", "-z", baselineTree],
      { env: indexEnv, encoding: null },
    ).stdout;
    const status = parseNameStatus(Buffer.from(nameStatus));
    fs.rmSync(path.join(temporary, ".git"), { recursive: true, force: true });
    const recovery = {
      schema: "tura.benchmark.changed-workspace.v1",
      layout: "changed-files",
      completeRepository: false,
      patchSha256: record.patchSha256,
      included: status.included,
      deleted: status.deleted,
      agent: record.agent,
      taskId: record.summary.taskId,
      runId: record.runId,
      sourceBatch: record.rawBatch,
      sourceRun: relativeSlash(
        record.rawManifestRoot,
        record.rawAgentDirectory,
      ),
      repository: record.repository,
      baseCommit: record.baseCommit,
      baselineTree,
      recoverySource: `${record.patchSource}-and-pinned-git-blobs`,
      diffVerifiedByteForByte: true,
    };
    writeJson(path.join(temporary, WORKSPACE_MANIFEST), recovery);
    fs.rmSync(record.workspace, { recursive: true, force: true });
    fs.renameSync(temporary, record.workspace);
    return recovery;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function initializeRecoveryRepository(directory, objectDirectories) {
  fs.rmSync(path.join(directory, ".git"), { recursive: true, force: true });
  runGit(directory, ["init", "-q"]);
  runGit(directory, ["config", "core.autocrlf", "false"]);
  runGit(directory, ["config", "core.filemode", "false"]);
  const alternates = path.join(
    directory,
    ".git",
    "objects",
    "info",
    "alternates",
  );
  fs.mkdirSync(path.dirname(alternates), { recursive: true });
  fs.writeFileSync(
    alternates,
    `${[...new Set(objectDirectories)].map((item) => path.resolve(item).replaceAll("\\", "/")).join("\n")}\n`,
  );
}

function ensureMirror(record, { cacheRoot, offline }) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const repositoryName = path.basename(
    String(record.repository).replace(/\.git$/, ""),
  );
  const key = `${safeName(repositoryName)}-${sha256(record.repository).slice(0, 12)}.git`;
  const mirror = path.join(cacheRoot, key);
  if (!fs.existsSync(path.join(mirror, "HEAD"))) {
    if (offline)
      throw new Error(`offline recovery cache is missing: ${mirror}`);
    run("git", [
      "clone",
      "--mirror",
      "--filter=blob:none",
      record.repository,
      mirror,
    ]);
  }
  if (!gitObjectExists(mirror, `${record.baseCommit}^{commit}`)) {
    if (offline)
      throw new Error(
        `offline recovery cache lacks ${record.baseCommit}: ${mirror}`,
      );
    run("git", [
      `--git-dir=${mirror}`,
      "fetch",
      "--filter=blob:none",
      "origin",
      record.baseCommit,
    ]);
  }
  return mirror;
}

function primeBaseBlobs(record, mirror) {
  const paths = new Set(
    patchFileChanges(record.patchText)
      .flatMap((change) => [change.oldPath, change.newPath])
      .filter(Boolean),
  );
  for (const relative of paths) {
    run(
      "git",
      [`--git-dir=${mirror}`, "show", `${record.baseCommit}:${relative}`],
      { allowFailure: true, encoding: null },
    );
  }
}

function discoverRawManifests(rawRoot) {
  const byRunId = new Map();
  const searchRoots = [rawRoot];
  if (!fs.existsSync(path.join(rawRoot, "manifest.json"))) {
    searchRoots.splice(
      0,
      1,
      ...fs
        .readdirSync(rawRoot, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (entry.name.includes("deep-swe") || entry.name === "_cache"),
        )
        .map((entry) => path.join(rawRoot, entry.name)),
    );
  }
  const files = searchRoots.flatMap((searchRoot) =>
    walkFiles(searchRoot, {
      match: (entry) => entry.name === "manifest.json",
      skip: (entry) =>
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "runs" ||
        entry.name === "_workspaces" ||
        entry.name === "_attempts",
      maxDepth: 3,
    }),
  );
  for (const file of files) {
    const manifest = readJson(file, null);
    if (manifest?.schema !== "tura.benchmark.deep-swe-matrix.v1") continue;
    const root = path.dirname(file);
    const selection = readJson(path.join(root, "selection.json"), null);
    const tasks = new Map(
      (selection?.tasks || []).map((task) => [task.task_id, task]),
    );
    for (const job of manifest.jobs || []) {
      if (job?.task?.task_id && !tasks.has(job.task.task_id))
        tasks.set(job.task.task_id, job.task);
    }
    byRunId.set(manifest.run_id, { root, manifest, tasks });
  }
  return byRunId;
}

function discoverPublishedRuns(resultsRoot) {
  const found = [];
  for (const summaryPath of walkFiles(resultsRoot, {
    match: (entry, parent) =>
      entry.name === "summary.json" && path.basename(parent) === "metadata",
    skip: (entry) => entry.name === ".git" || entry.name === "node_modules",
  })) {
    const runDirectory = path.dirname(path.dirname(summaryPath));
    const agent = path.basename(path.dirname(runDirectory));
    const task = path.basename(path.dirname(path.dirname(runDirectory)));
    const report = path.basename(
      path.dirname(path.dirname(path.dirname(runDirectory))),
    );
    const summary = readJson(summaryPath);
    found.push({ summaryPath, runDirectory, agent, task, report, summary });
  }
  return found.sort((left, right) =>
    left.runDirectory.localeCompare(right.runDirectory),
  );
}

function resolveRecord(run, manifests) {
  const replicate = Number(run.summary.runId?.match(/run-(\d+)$/)?.[1]);
  assert(
    Number.isInteger(replicate),
    `cannot parse replicate: ${run.summary.runId}`,
  );
  const invocation = readJson(
    path.join(run.runDirectory, "metadata", "source-invocation.json"),
    null,
  );
  let raw = manifests.get(run.summary.sourceBatch);
  if (!raw && invocation) {
    const invocationText = stringValues(invocation).join("\n");
    raw = [...manifests.values()].find((candidate) =>
      invocationText.includes(candidate.root),
    );
  }
  if (!raw) {
    raw = [...manifests.values()].find((candidate) =>
      fs.existsSync(
        path.join(
          candidate.root,
          "runs",
          run.summary.taskId,
          `${run.agent}-r${replicate}`,
          "model.patch",
        ),
      ),
    );
  }
  assert(raw, `raw batch not found: ${run.summary.sourceBatch}`);
  const invocationArtifact = [
    invocation?.env?.CODEX_LOG_DIR,
    invocation?.env?.LOG_PATH,
    invocation?.env?.OPENAI_PROVIDER_LOG,
  ].find(
    (value) =>
      value && path.resolve(value).startsWith(`${raw.root}${path.sep}`),
  );
  const rawAgentDirectory = invocationArtifact
    ? path.dirname(path.resolve(invocationArtifact))
    : path.join(
        raw.root,
        "runs",
        run.summary.taskId,
        `${run.agent}-r${replicate}`,
      );
  const sourceSummary = readJson(
    path.join(rawAgentDirectory, "agent-summary.json"),
    null,
  );
  const publishedDiff = path.join(
    run.runDirectory,
    "metadata",
    "contracts",
    "git-diff.patch",
  );
  const rawPatchCandidate = path.join(rawAgentDirectory, "model.patch");
  const task = raw.tasks.get(run.summary.taskId) || {};
  const repository = sourceSummary?.repo || task.repository_url;
  const baseCommit = task.base_commit_hash;
  assert(repository, `repository missing for ${run.summary.runId}`);
  assert(baseCommit, `base commit missing for ${run.summary.runId}`);
  const rawPatch = fs.existsSync(rawPatchCandidate)
    ? rawPatchCandidate
    : fs.existsSync(publishedDiff)
      ? publishedDiff
      : null;
  const retainedWorkspace = rawPatch
    ? null
    : retainedRawWorkspace(invocation, raw.root);
  assert(
    rawPatch || retainedWorkspace,
    `neither patch nor retained raw workspace exists for ${run.summary.runId}`,
  );
  const patchBuffer = rawPatch
    ? fs.readFileSync(rawPatch)
    : patchFromRetainedWorkspace(
        retainedWorkspace,
        baseCommit,
        run.summary.runId,
      );
  return {
    ...run,
    runId: run.summary.runId,
    rawManifestRoot: raw.root,
    rawAgentDirectory,
    rawPatch,
    patchBuffer,
    patchText: patchBuffer.toString("utf8"),
    patchSha256: sha256(patchBuffer),
    publishedDiff,
    workspace: path.join(run.runDirectory, "workspace"),
    repository,
    baseCommit,
    rawBatch: raw.manifest.run_id,
    patchSource: rawPatch
      ? fs.existsSync(rawPatchCandidate)
        ? "raw-model-patch"
        : "published-diff-raw-copy"
      : "retained-raw-git-workspace",
    retainedWorkspace,
  };
}

function retainedRawWorkspace(invocation, rawRoot) {
  const cwdArg = invocation?.args?.indexOf("--cwd");
  const candidate =
    invocation?.cwd ||
    (Number.isInteger(cwdArg) && cwdArg >= 0
      ? invocation.args[cwdArg + 1]
      : null);
  if (!candidate) return null;
  const workspace = path.resolve(candidate);
  const relative = path.relative(path.resolve(rawRoot), workspace);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(path.join(workspace, ".git"))) return null;
  return workspace;
}

function patchFromRetainedWorkspace(workspace, baseCommit, runId) {
  const head = runGit(workspace, ["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(
    head,
    baseCommit,
    `retained workspace HEAD differs from pinned base for ${runId}`,
  );
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "tura-debug-workspace-index-"),
  );
  try {
    const indexEnv = { GIT_INDEX_FILE: path.join(temporary, "index") };
    runGit(workspace, ["read-tree", "HEAD"], { env: indexEnv });
    runGit(
      workspace,
      ["-c", "core.filemode=false", "-c", "core.autocrlf=false", "add", "-A"],
      { env: indexEnv },
    );
    return Buffer.from(
      runGit(
        workspace,
        ["-c", "core.abbrev=7", "diff", "--cached", "--binary", "HEAD"],
        { env: indexEnv, encoding: null },
      ).stdout,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function ensurePublishedDiff(record) {
  if (fs.existsSync(record.publishedDiff)) {
    const published = fs.readFileSync(record.publishedDiff);
    if (!published.equals(record.patchBuffer))
      throw new Error(
        `published diff differs from raw: ${record.publishedDiff}`,
      );
    return;
  }
  fs.mkdirSync(path.dirname(record.publishedDiff), { recursive: true });
  fs.writeFileSync(record.publishedDiff, record.patchBuffer);
}

function updatePublishedMetadata(record, recovery) {
  const recoveryPath = path.join(
    record.runDirectory,
    "metadata",
    "workspace-recovery.json",
  );
  writeJson(recoveryPath, {
    ...recovery,
    workspace: "workspace",
    gitDiff: "metadata/contracts/git-diff.patch",
  });
  const contractPath = path.join(
    record.runDirectory,
    "metadata",
    "contracts",
    "contract-manifest.json",
  );
  const contract = readJson(contractPath, null);
  if (contract?.files) {
    contract.files.gitDiff = "metadata/contracts/git-diff.patch";
    contract.files.workspace = "workspace";
    writeJson(contractPath, contract);
  }
}

function checkRecords(records) {
  const failures = [];
  for (const record of records) {
    if (!fs.existsSync(record.publishedDiff))
      failures.push({ runId: record.runId, problem: "missing diff" });
    else if (!fs.readFileSync(record.publishedDiff).equals(record.patchBuffer))
      failures.push({ runId: record.runId, problem: "diff differs from raw" });
    if (!validWorkspace(record))
      failures.push({
        runId: record.runId,
        problem: "missing or invalid workspace",
      });
  }
  return { selected: records.length, ok: failures.length === 0, failures };
}

function validWorkspace(record) {
  return validRawWorkspace(record.workspace, record.patchSha256);
}

function validRawWorkspace(directory, expectedPatchSha256) {
  const manifest = readJson(path.join(directory, WORKSPACE_MANIFEST), null);
  return (
    manifest?.schema === "tura.benchmark.changed-workspace.v1" &&
    manifest.patchSha256 === expectedPatchSha256
  );
}

function lazyObjectDirectories(rawRoot, manifests) {
  let cached;
  return () => {
    if (cached) return cached;
    cached = [];
    for (const { root } of manifests.values()) {
      const workspaceRoot = path.join(root, "_workspaces");
      if (!fs.existsSync(workspaceRoot)) continue;
      for (const entry of fs.readdirSync(workspaceRoot, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const workspace = path.join(workspaceRoot, entry.name);
        const result = runGit(
          workspace,
          ["rev-parse", "--git-path", "objects"],
          {
            allowFailure: true,
          },
        );
        if (result.status !== 0) continue;
        const objects = path.resolve(workspace, result.stdout.trim());
        if (fs.existsSync(objects)) cached.push(objects);
      }
    }
    const direct = walkFiles(rawRoot, {
      match: (entry, parent) =>
        entry.name === "objects" && path.basename(parent) === ".git",
      skip: (entry) => entry.name === "node_modules" || entry.name === "_cache",
      directories: true,
      maxDepth: 7,
    });
    cached.push(...direct);
    return [...new Set(cached.map((item) => path.resolve(item)))];
  };
}

function findObjectStores(prefixes, objectDirectories) {
  if (!prefixes.length) return [];
  const found = [];
  const remaining = new Set(prefixes);
  for (const objects of objectDirectories) {
    const gitDirectory = path.dirname(path.dirname(objects));
    for (const prefix of [...remaining]) {
      if (gitObjectExists(gitDirectory, prefix)) {
        found.push(objects);
        remaining.delete(prefix);
      }
    }
    if (!remaining.size) break;
  }
  return [...new Set(found)];
}

function oldBlobPrefixes(patchText) {
  return [
    ...new Set(
      String(patchText)
        .split(/\r?\n/)
        .map((line) => line.match(/^index ([0-9a-f]+)\.\.[0-9a-f]+/)?.[1])
        .filter((hash) => hash && !/^0+$/.test(hash)),
    ),
  ];
}

function patchAbbrevLength(patchText) {
  const lengths = String(patchText)
    .split(/\r?\n/)
    .map((line) => line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/))
    .filter(Boolean)
    .flatMap((match) => [match[1].length, match[2].length]);
  return lengths.length ? Math.max(...lengths) : 7;
}

function gitObjectExists(gitDirectory, object) {
  return (
    run("git", [`--git-dir=${gitDirectory}`, "cat-file", "-e", object], {
      allowFailure: true,
    }).status === 0
  );
}

function parseNameStatus(buffer) {
  const fields = buffer.toString("utf8").split("\0").filter(Boolean);
  const included = [];
  const deleted = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (status.startsWith("R")) deleted.push(oldPath);
      included.push(newPath);
    } else {
      const relative = fields[index++];
      if (status === "D") deleted.push(relative);
      else included.push(relative);
    }
  }
  return {
    included: [...new Set(included)],
    deleted: [...new Set(deleted)],
  };
}

function patchHeaderPath(value, prefix) {
  const raw = value.split("\t", 1)[0];
  if (raw === "/dev/null") return null;
  let decoded = raw;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = raw.slice(1, -1);
    }
  }
  return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded;
}

function walkFiles(
  root,
  { match, skip = () => false, directories = false, maxDepth = Infinity },
) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (directory, depth) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (skip(entry, directory)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (directories && match(entry, directory)) result.push(full);
        if (depth < maxDepth) visit(full, depth + 1);
      } else if (!directories && match(entry, directory)) result.push(full);
    }
  };
  visit(root, 0);
  return result;
}

function runGit(cwd, args, options = {}) {
  return run("git", ["-C", cwd, ...args], options);
}

function run(command, args, options = {}) {
  const encoding = options.encoding === null ? null : "utf8";
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding,
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr || "");
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}: ${stderr.trim()}`,
    );
  }
  return result;
}

function publicRecord(record) {
  return {
    report: record.report,
    taskId: record.summary.taskId,
    agent: record.agent,
    runId: record.runId,
    sourceBatch: record.summary.sourceBatch,
    patchSource: record.patchSource,
    workspace: record.workspace,
  };
}

function safeJoin(root, relative) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  assert(
    target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`),
    `path escapes workspace: ${relative}`,
  );
  return target;
}

function safeName(value) {
  return String(value || "repository")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stringValues(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) stringValues(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringValues(item, result);
  }
  return result;
}

function relativeSlash(from, to) {
  return path.relative(from, to).replaceAll("\\", "/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function firstBufferDifference(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return length;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (arguments.length > 1 && error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const newline =
    fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("\r\n")
      ? "\r\n"
      : "\n";
  fs.writeFileSync(
    file,
    `${JSON.stringify(value, null, 2).replaceAll("\n", newline)}${newline}`,
  );
}
