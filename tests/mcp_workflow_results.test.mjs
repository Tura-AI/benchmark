import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(
  repoRoot,
  "results",
  "mcp",
  "report-mcp-workflow-gpt56-sol-low-20260809",
  "manifest.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function resolvePublished(relativePath) {
  assert.equal(path.isAbsolute(relativePath), false, relativePath);
  assert.doesNotMatch(relativePath, /^[A-Za-z]:[\\/]/, relativePath);
  const resolved = path.resolve(repoRoot, relativePath);
  assert.ok(
    resolved.startsWith(path.join(repoRoot, "results", "mcp") + path.sep),
    relativePath,
  );
  return resolved;
}

function jsonLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(candidate) : [candidate];
  });
}

test("published MCP workflow batch is self-contained", () => {
  assert.equal(manifest.schemaVersion, "1.1.0");
  assert.equal(manifest.runCount, 90);
  assert.equal(manifest.runs.length, 90);
  assert.equal(manifest.outcome.passed, 84);
  assert.equal(manifest.outcome.failed, 6);

  let roundCount = 0;
  for (const run of manifest.runs) {
    const runRoot = resolvePublished(run.artifactPath);
    assert.ok(fs.statSync(runRoot).isDirectory(), run.runId);

    for (const artifactPath of Object.values(run.artifacts)) {
      assert.ok(fs.existsSync(resolvePublished(artifactPath)), artifactPath);
    }

    const workspace = resolvePublished(run.artifacts.workspace);
    assert.equal(fs.existsSync(path.join(workspace, ".git")), false);
    assert.equal(fs.existsSync(path.join(workspace, ".tura")), false);

    const roundsDirectory = resolvePublished(run.artifacts.rounds);
    const roundFiles = fs
      .readdirSync(roundsDirectory)
      .filter((name) => name.endsWith(".json"));
    assert.equal(roundFiles.length, run.rounds, run.runId);
    roundCount += roundFiles.length;

    for (const roundFile of roundFiles) {
      const round = JSON.parse(
        fs.readFileSync(path.join(roundsDirectory, roundFile), "utf8"),
      );
      assert.equal(round.sources.stdoutPath, "agent/stdout.jsonl");
      assert.equal(
        round.sources.providerCallsPath,
        "agent/context-and-calls/provider-calls-full.jsonl",
      );
      if (round.rawCallbackPath) {
        assert.match(round.rawCallbackPath, /^agent\/rounds\/.+\.json$/u);
      }
      assert.doesNotMatch(JSON.stringify(round.sources), /[A-Za-z]:[\\/]/u);
    }

    const trace = jsonLines(resolvePublished(run.artifacts.mcpTrace));
    assert.ok(
      trace.some((event) => event.method === "initialize"),
      run.runId,
    );
    assert.ok(
      trace.some((event) => event.method === "tools/list"),
      run.runId,
    );
    if (run.status === "pass") {
      assert.ok(
        trace.some((event) => event.method === "tools/call"),
        run.runId,
      );
    }
  }

  assert.equal(roundCount, 465);

  for (const file of filesBelow(
    resolvePublished(manifest.source.publishedRoot),
  )) {
    const contents = fs.readFileSync(file, "utf8");
    assert.equal(contents.includes("C:\\Users\\liuliu"), false, file);
    assert.equal(contents.includes("C:\\\\Users\\\\liuliu"), false, file);
  }
});
