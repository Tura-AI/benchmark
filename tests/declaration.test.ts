import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverTaskDeclarations } from "../src/declaration.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot =
  [
    path.resolve(testDirectory, ".."),
    path.resolve(testDirectory, "..", ".."),
  ].find((candidate) => existsSync(path.join(candidate, "tasks"))) ??
  path.resolve(testDirectory, "..", "..");
const repoRoot = path.resolve(benchmarkRoot, "..");

test("discovers the current benchmark task declarations", async () => {
  const declarations = await discoverTaskDeclarations(benchmarkRoot);

  assert.equal(declarations.length, 36);
  assert.deepEqual(countByType(declarations), {
    build: 0,
    design: 0,
    debug: 1,
    mcp: 30,
    rewrite: 5,
  });
  assert.deepEqual(
    declarations.map((declaration) => declaration.id),
    [
      "deep-swe-v1.1",
      "mcp-async-worker-pool",
      "mcp-atomic-json-store",
      "mcp-checkpoint-pipeline",
      "mcp-circuit-breaker",
      "mcp-config-precedence",
      "mcp-cron-schedule-engine",
      "mcp-dependency-graph-planner",
      "mcp-hash-chained-audit-log",
      "mcp-json-diff-patch",
      "mcp-ordered-batch-executor",
      "mcp-plugin-dependency-loader",
      "mcp-priority-event-bus",
      "mcp-recursive-secret-redaction",
      "mcp-retry-policy",
      "mcp-safe-query-language",
      "mcp-schema-migration-registry",
      "mcp-signed-cursor-pagination",
      "mcp-targeted-feature-flags",
      "mcp-token-bucket-limiter",
      "mcp-ttl-lru-cache",
      "prompt-gallery-tanstack-fullstack-rebuild",
      "source-port-python-default-eza",
      "source-port-python-default-nushell",
      "source-port-python-default-xsv",
      "source-port-python-default-zip-password-finder",
      "workflow-campaign-image-email",
      "workflow-contract-signature",
      "workflow-customer-onboarding",
      "workflow-ecommerce-ad-package",
      "workflow-event-promo-kit",
      "workflow-incident-response",
      "workflow-invoice-email-followup",
      "workflow-product-demo-video",
      "workflow-recruiting-interview-pack",
      "workflow-social-thumbnail-approval",
    ],
  );
});

test("all declared variants point at existing task-local runners", async () => {
  const declarations = await discoverTaskDeclarations(benchmarkRoot);

  for (const declaration of declarations) {
    const taskDirectory = path.join(benchmarkRoot, declaration.directory);
    assert.ok(
      existsSync(path.join(taskDirectory, "benchmark.task.json")),
      declaration.id,
    );
    for (const variant of declaration.variants) {
      assert.ok(
        existsSync(path.join(taskDirectory, variant.runner)),
        `${declaration.id}:${variant.id}`,
      );
    }
  }
});

test("rewrite benchmark questions use one configured runner entry", async () => {
  const declarations = await discoverTaskDeclarations(benchmarkRoot);

  for (const declaration of declarations.filter(
    (item) => item.type === "rewrite",
  )) {
    assert.equal(declaration.variants.length, 1, declaration.id);
    assert.equal(declaration.duplicatePolicy, "none", declaration.id);
    assert.equal(declaration.variants[0]?.default, true, declaration.id);
    assert.ok(declaration.variants[0]?.env, declaration.id);
  }
});

function countByType(
  declarations: Awaited<ReturnType<typeof discoverTaskDeclarations>>,
) {
  return declarations.reduce(
    (counts, declaration) => {
      counts[declaration.type] += 1;
      return counts;
    },
    { build: 0, design: 0, debug: 0, mcp: 0, rewrite: 0 },
  );
}
