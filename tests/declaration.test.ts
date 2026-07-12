import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverTaskDeclarations } from "../src/declaration.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = [path.resolve(testDirectory, ".."), path.resolve(testDirectory, "..", "..")]
  .find((candidate) => existsSync(path.join(candidate, "tasks"))) ?? path.resolve(testDirectory, "..", "..");
const repoRoot = path.resolve(benchmarkRoot, "..");

test("discovers the current benchmark task declarations", async () => {
  const declarations = await discoverTaskDeclarations(benchmarkRoot);

  assert.equal(declarations.length, 6);
  assert.deepEqual(countByType(declarations), { build: 0, design: 0, debug: 1, refactoring: 5 });
  assert.deepEqual(
    declarations.map((declaration) => declaration.id),
    [
      "prompt-gallery-tanstack-fullstack-rebuild",
      "source-port-python-default-eza",
      "source-port-python-default-nushell",
      "source-port-python-default-xsv",
      "source-port-python-default-zip-password-finder",
      "swebench-verified-issue-patch",
    ],
  );
});

test("all declared variants point at existing task-local runners", async () => {
  const declarations = await discoverTaskDeclarations(benchmarkRoot);

  for (const declaration of declarations) {
    const taskDirectory = path.join(benchmarkRoot, "tasks", declaration.type, path.basename(declaration.directory));
    assert.equal(path.normalize(path.join(repoRoot, declaration.directory)), path.normalize(taskDirectory));
    assert.ok(existsSync(path.join(taskDirectory, "benchmark.task.json")), declaration.id);
    for (const variant of declaration.variants) {
      assert.ok(existsSync(path.join(taskDirectory, variant.runner)), `${declaration.id}:${variant.id}`);
    }
  }
});

test("refactoring benchmark questions use one local runner entry", async () => {
  const declarations = await discoverTaskDeclarations(benchmarkRoot);

  for (const declaration of declarations.filter((item) => item.type === "refactoring")) {
    assert.equal(declaration.variants.length, 1, declaration.id);
    assert.equal(declaration.duplicatePolicy, "none", declaration.id);
    assert.equal(declaration.variants[0]?.default, true, declaration.id);
    assert.equal(declaration.variants[0]?.env, undefined, declaration.id);
  }
});

function countByType(declarations: Awaited<ReturnType<typeof discoverTaskDeclarations>>) {
  return declarations.reduce(
    (counts, declaration) => {
      counts[declaration.type] += 1;
      return counts;
    },
    { build: 0, design: 0, debug: 0, refactoring: 0 },
  );
}
