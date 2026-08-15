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
const pluginSavings = readJson("assets/plugin-token-savings/summary.json");
const pluginAbRuns = readJson("blog_data/token-saving-plugin-eza/runs.json");
const pluginAbSummary = readJson(
  "blog_data/token-saving-plugin-eza/summary.json",
);
const pluginAbMethodology = readJson(
  "blog_data/token-saving-plugin-eza/methodology.json",
);
const pluginAbActivationAudit = fs
  .readFileSync(
    path.join(
      root,
      "blog_data/token-saving-plugin-eza/round-activation-audit.jsonl",
    ),
    "utf8",
  )
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
const pluginBlog = fs.readFileSync(
  path.join(root, "doc/blog-token-saving-plugins.md"),
  "utf8",
);
const pluginReport = fs.readFileSync(
  path.join(root, "assets/plugin-token-savings/report.md"),
  "utf8",
);

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
  assert.equal(
    pluginSavings.population.published_harness_runs,
    expected.runsPerConfiguration * config.pluginSavingsConfigurations.length,
  );
  assert.deepEqual(
    pluginSavings.population.configurations,
    [...config.pluginSavingsConfigurations].sort(),
  );
  assert.equal(
    pluginSavings.ponytail.code_content_observation.covered_runs +
      pluginSavings.ponytail.code_content_observation.missing_code_body_runs,
    expected.runsPerConfiguration * config.pluginSavingsConfigurations.length,
  );
  assert.deepEqual(
    pluginSavings.population.pricing_usd_per_million,
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
  for (const [directory, stems] of [
    [config.outputs.claimCharts, config.artifacts.claimCharts],
    [config.outputs.harnessCode, config.artifacts.harnessCodeCharts],
  ]) {
    const expectedCharts = stems
      .flatMap((stem) =>
        ["png", "svg"].map((extension) => `${stem}.${extension}`),
      )
      .sort();
    const actualCharts = fs
      .readdirSync(path.join(root, directory))
      .filter((name) => /\.(png|svg)$/.test(name))
      .sort();
    assert.deepEqual(actualCharts, expectedCharts, directory);

    for (const stem of stems) {
      const svg = fs.readFileSync(
        path.join(root, directory, `${stem}.svg`),
        "utf8",
      );
      assert.doesNotMatch(svg, /<dc:date>/, `${stem}.svg embeds a build date`);
    }
  }

  const documentedCharts = [
    ...`${evidenceRecord}\n${methodology}`.matchAll(
      /assets\/(?:model-run-statistics\/claim-charts|harness-code-statistics)\/([^"\\)]+)\.png/g,
    ),
  ]
    .map((match) => match[1])
    .sort();
  const configuredCharts = new Set([
    ...config.artifacts.claimCharts,
    ...config.artifacts.harnessCodeCharts,
  ]);
  assert.ok(
    documentedCharts.length > 0,
    "protected docs contain no chart references",
  );
  assert.equal(new Set(documentedCharts).size, documentedCharts.length);
  for (const stem of documentedCharts) {
    assert.ok(
      configuredCharts.has(stem),
      `unconfigured documented chart: ${stem}`,
    );
  }
});

test("analysis scripts consume configuration instead of embedding the cohort", () => {
  const scripts = [
    "scripts/model_run_statistics.py",
    "scripts/model_run_claim_charts.py",
    "scripts/harness_code_size_analysis.py",
    "scripts/plugin_token_savings.py",
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
  for (const source of scripts.slice(1, 3)) {
    assert.match(source, /"svg\.hashsalt": "tura-benchmark-analysis-v1"/);
    assert.match(source, /metadata=SVG_METADATA/);
  }
});

test("package scripts expose the ordered shared analysis pipeline", () => {
  const packageJson = readJson("package.json");
  assert.equal(
    packageJson.scripts["analysis:reports"],
    "npm run analysis:model-runs && npm run analysis:claim-charts && npm run analysis:harness-code && npm run analysis:plugin-savings && npm run analysis:plugin-ab",
  );
  for (const name of [
    "analysis:model-runs",
    "analysis:claim-charts",
    "analysis:harness-code",
    "analysis:plugin-savings",
    "analysis:plugin-ab",
  ]) {
    assert.match(packageJson.scripts[name], /scripts\/python\.mjs/);
  }
});

test("the plugin analysis is Codex-only and the English blog cites one primary paper", () => {
  assert.deepEqual(pluginSavings.population.configurations, [
    "codex-cli-high",
    "codex-cli-medium",
  ]);
  assert.equal(pluginSavings.population.published_harness_runs, 140);
  assert.match(pluginBlog, /No Tura runs are included/i);
  assert.match(pluginBlog, /901,608,531/);
  assert.match(pluginBlog, /96\.46%/);
  assert.match(pluginBlog, /0\.0568%/);
  assert.match(pluginBlog, /2604\.22750/);
  assert.equal(
    [...pluginBlog.matchAll(/https:\/\/arxiv\.org\/abs\/([0-9.]+)/g)].length,
    1,
  );
  assert.doesNotMatch(pluginBlog, /[\u3400-\u9fff]/);
  assert.doesNotMatch(pluginReport, /[\u3400-\u9fff]/);
});

test("the public plugin A/B package is complete and matches the article", () => {
  assert.equal(pluginAbRuns.runs.length, 8);
  assert.equal(
    pluginAbRuns.runs.filter((run) => run.arm !== "no-plugin").length,
    6,
  );
  assert.ok(pluginAbRuns.runs.every((run) => run.codex_exit_code === 0));
  assert.deepEqual(pluginAbRuns.runs.map((run) => run.run).sort(), [
    "caveman-r1",
    "caveman-r2",
    "no-plugin-high-r1",
    "no-plugin-high-r2",
    "ponytail-r2",
    "ponytail-r3",
    "rtk-r2",
    "rtk-r3",
  ]);
  assert.equal(pluginAbSummary.aggregates.ponytail.n, 2);
  assert.equal(pluginAbSummary.aggregates.rtk.n, 2);
  assert.equal(pluginAbSummary.aggregates.caveman.n, 2);
  assert.equal(pluginAbSummary.aggregates.caveman.mean_passed, 45);
  assert.equal(pluginAbSummary.aggregates.caveman.mean_rounds, 57);
  assert.equal(pluginAbSummary.aggregates.caveman.mean_cost_usd, 5.076112);
  assert.ok(
    Math.abs(
      pluginAbSummary.deltas_vs_no_plugin_high.caveman.cost_percent +
        3.8969349554122554,
    ) < 1e-9,
  );
  assert.equal(pluginAbSummary.aggregates["no-plugin"].n, 2);
  assert.equal(pluginAbMethodology.activation.audited_plugin_rounds, 407);
  assert.equal(pluginAbActivationAudit.length, 407);
  assert.equal(
    pluginAbActivationAudit.filter((record) => record.arm === "caveman").length,
    114,
  );
  assert.ok(
    pluginAbActivationAudit.every(
      (record) => record.exclusive_activation_verdict === true,
    ),
  );
  for (const runId of ["caveman-r1", "caveman-r2"]) {
    const run = pluginAbRuns.runs.find((record) => record.run === runId);
    const rounds = pluginAbActivationAudit.filter(
      (record) => record.run === runId,
    );
    const cumulative = rounds.at(-1).cumulative_usage;
    assert.deepEqual(cumulative, {
      input_tokens: run.usage.input_tokens,
      cached_input_tokens: run.usage.cached_input_tokens,
      output_tokens: run.usage.output_tokens,
      reasoning_output_tokens: run.usage.reasoning_tokens,
      total_tokens: run.usage.total_tokens,
    });
  }
  assert.ok(
    Math.abs(
      pluginAbSummary.deltas_vs_no_plugin_high.ponytail.cost_percent +
        8.87134211519769,
    ) < 1e-9,
  );
  for (const arm of ["no-plugin", "ponytail", "rtk"]) {
    assert.ok(
      pluginAbSummary.within_arm_variation[arm].cost_usd.range_percent_of_mean >
        Math.abs(
          pluginAbSummary.deltas_vs_no_plugin_high.ponytail.cost_percent,
        ),
    );
  }
  for (const artifact of [
    "README.md",
    "runs.json",
    "summary.json",
    "methodology.json",
    "round-activation-audit.jsonl",
  ]) {
    assert.ok(
      fs.existsSync(
        path.join(root, "blog_data/token-saving-plugin-eza", artifact),
      ),
      artifact,
    );
  }
  assert.match(pluginBlog, /Matched plugin runs/);
  assert.match(pluginBlog, /Broad cost distribution/);
  assert.match(pluginBlog, /Claim-rate scenarios/);
  assert.match(pluginBlog, /Rust.*Python/i);
  assert.match(pluginBlog, /51\.69%/);
  assert.match(pluginBlog, /30\.78%/);
  assert.match(pluginBlog, /43\.25%/);
  assert.match(pluginBlog, /407-round activation audit/);
  assert.doesNotMatch(pluginBlog, /Ponytail, all runs/i);
  assert.doesNotMatch(pluginBlog, /426-round activation audit/);
});

test("the evidence record uses continuous prose without observation labels", () => {
  const normalizedProse = evidenceRecord.replace(/\s+/g, " ");
  assert.doesNotMatch(
    normalizedProse,
    /in plain language|full report|main observation|detailed observations/i,
  );
  assert.doesNotMatch(evidenceRecord, /^\*\*[^*]+\.\*\*/gm);
});
