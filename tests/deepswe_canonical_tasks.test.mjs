import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = JSON.parse(
  fs.readFileSync(path.join(root, "deep_swe", "canonical_tasks.json"), "utf8"),
);

const expectedTaskIds = [
  "actionlint-action-pinning-lint",
  "abs-stepped-slices",
  "yaegi-go-embed-directives",
  "dasel-html-document-format",
  "narwhals-rolling-window-suite",
  "numba-stencil-boundary-modes",
  "bandit-incremental-cache-control",
  "langchain-request-coalescing",
  "happy-dom-abort-pending-body-reads",
  "dynamodb-toolbox-conditional-attribute-requirements",
  "awilix-async-container-initialization",
  "quill-shared-toolbar-focus",
  "wasmi-trap-coredumps",
  "fd-deterministic-multi-key-sorting",
  "boa-hierarchical-evaluation-cancellation",
  "pest-character-class-coalescing",
  "yjs-map-conflict-detection",
  "testem-per-launcher-reports",
  "csstree-shorthand-expansion-compression",
  "katex-multicolumn-array-spans",
];

test("DeepSWE comparison cohort is pinned to the original 20 tasks", () => {
  assert.equal(
    canonical.schema,
    "tura.benchmark.deep-swe-canonical-task-set.v1",
  );
  assert.deepEqual(
    canonical.tasks.map((task) => task.task_id),
    expectedTaskIds,
  );
  for (const field of ["language", "difficulty_band"]) {
    const counts = canonical.tasks.reduce((result, task) => {
      result[task[field]] = (result[task[field]] || 0) + 1;
      return result;
    }, {});
    assert.deepEqual(
      counts,
      field === "language"
        ? { go: 4, python: 4, typescript: 4, rust: 4, javascript: 4 }
        : { easy: 5, "medium-easy": 5, "medium-hard": 5, hard: 5 },
    );
  }
});
