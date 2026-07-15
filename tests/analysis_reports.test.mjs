import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const config = readJson("config/analysis.json");
const diagnostics = readJson("assets/model-run-statistics/diagnostics.json");
const claims = readJson(
  "assets/model-run-statistics/claim-charts/claim-chart-summary.json",
);
const code = readJson("assets/harness-code-statistics/summary.json");

function countNamedFiles(directory, fileName) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countNamedFiles(target, fileName);
    if (entry.isFile() && entry.name === fileName) count += 1;
  }
  return count;
}
const evidenceRecord = fs.readFileSync(
  path.join(root, "doc/current-test-set-record.md"),
  "utf8",
);
const methodology = fs.readFileSync(
  path.join(root, "doc/benchmark-methodology.md"),
  "utf8",
);

function readCsv(relative) {
  const lines = fs
    .readFileSync(path.join(root, relative), "utf8")
    .trimEnd()
    .split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]]),
    );
  });
}

test("analysis configuration owns the published report cohort", () => {
  assert.equal(config.schema, "tura.benchmark.analysis-config.v1");
  assert.equal(
    config.reports.reduce((sum, report) => sum + report.expectedRuns, 0),
    config.population.sourceRuns,
  );
  assert.equal(
    config.population.sourceRuns - config.relationshipExclusions.length,
    config.population.relationshipRuns,
  );
  for (const report of config.reports) {
    const reportDirectory = path.join(root, config.resultsRoot, report.path);
    assert.ok(
      fs.existsSync(reportDirectory),
      `missing configured report: ${report.path}`,
    );
    assert.equal(
      countNamedFiles(reportDirectory, "harness-report.json"),
      report.expectedRuns,
      `contract count drifted: ${report.path}`,
    );
  }
});

test("generated summaries and rows agree with the configured population", () => {
  const rows = readCsv("assets/model-run-statistics/run-level-data.csv");
  const excluded = readCsv("assets/model-run-statistics/excluded-runs.csv");
  const codeRows = readCsv(
    "assets/harness-code-statistics/run-level-code-harness.csv",
  );
  const expected = config.population;

  assert.equal(diagnostics.source_audit.run_count, expected.sourceRuns);
  assert.equal(
    diagnostics.analysis_sample.run_count,
    expected.relationshipRuns,
  );
  assert.equal(diagnostics.analysis_sample.task_count, expected.tasks);
  assert.equal(claims.sample.runs, expected.relationshipRuns);
  assert.equal(claims.sample.tasks, expected.tasks);
  assert.equal(
    code.analysis_population.published_harness_runs,
    expected.sourceRuns,
  );
  assert.equal(
    code.analysis_population.relationship_runs,
    expected.relationshipRuns,
  );
  assert.equal(
    code.analysis_population.code_observed_runs,
    expected.codeObservedRuns,
  );
  assert.equal(rows.length, expected.relationshipRuns);
  assert.equal(excluded.length, config.relationshipExclusions.length);
  assert.equal(codeRows.length, expected.relationshipRuns);
  assert.deepEqual(
    diagnostics.pricing_usd_per_1m_tokens,
    config.pricingUsdPer1mTokens,
  );
  assert.deepEqual(
    claims.pricing_usd_per_1m_tokens,
    config.pricingUsdPer1mTokens,
  );
  assert.deepEqual(
    code.pricing_usd_per_1m_tokens,
    config.pricingUsdPer1mTokens,
  );
  assert.deepEqual(
    code.code_metric.source_extensions,
    [...config.codeMetric.sourceExtensions].sort(),
  );
  assert.deepEqual(
    code.code_metric.excluded_path_parts,
    [...config.codeMetric.excludedPathParts].sort(),
  );

  const reportCounts = new Map();
  for (const row of [...rows, ...excluded]) {
    reportCounts.set(row.report, (reportCounts.get(row.report) || 0) + 1);
    assert.equal(path.isAbsolute(row.source_path), false, row.source_path);
    assert.ok(
      fs.existsSync(path.join(root, config.resultsRoot, row.source_path)),
      `missing source contract: ${row.source_path}`,
    );
  }
  for (const report of config.reports) {
    assert.equal(
      reportCounts.get(path.basename(report.path)),
      report.expectedRuns,
      report.path,
    );
  }
});

test("the configured statistical artifact set is complete", () => {
  for (const stem of config.artifacts.claimCharts) {
    for (const extension of ["png", "svg"]) {
      assert.ok(
        fs.existsSync(
          path.join(root, config.outputs.claimCharts, `${stem}.${extension}`),
        ),
        `${stem}.${extension}`,
      );
    }
  }
  for (const stem of config.artifacts.harnessCodeCharts) {
    for (const extension of ["png", "svg"]) {
      assert.ok(
        fs.existsSync(
          path.join(root, config.outputs.harnessCode, `${stem}.${extension}`),
        ),
        `${stem}.${extension}`,
      );
    }
  }
  const actualClaimCharts = fs
    .readdirSync(path.join(root, config.outputs.claimCharts))
    .filter((name) => /\.(png|svg)$/.test(name))
    .sort();
  const expectedClaimCharts = config.artifacts.claimCharts
    .flatMap((stem) =>
      ["png", "svg"].map((extension) => `${stem}.${extension}`),
    )
    .sort();
  assert.deepEqual(actualClaimCharts, expectedClaimCharts);

  const documentedCharts = [...`${evidenceRecord}\n${methodology}`.matchAll(
    /assets\/(?:model-run-statistics\/claim-charts|harness-code-statistics)\/([^"\\)]+)\.png/g,
  )]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(
    documentedCharts,
    [
      ...config.artifacts.claimCharts,
      ...config.artifacts.harnessCodeCharts,
    ].sort(),
  );
});

test("analysis scripts consume configuration instead of embedding the cohort", () => {
  const scripts = [
    "scripts/model_run_statistics.py",
    "scripts/model_run_claim_charts.py",
    "scripts/harness_code_size_analysis.py",
  ].map((relative) => fs.readFileSync(path.join(root, relative), "utf8"));
  for (const source of scripts) {
    assert.doesNotMatch(source, /C:\\Users\\/);
    for (const report of config.reports) {
      assert.equal(
        source.includes(path.basename(report.path)),
        false,
        report.path,
      );
    }
  }
});

test("package scr