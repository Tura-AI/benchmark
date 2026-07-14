#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRIALS_URL = "https://deepswe.datacurve.ai/artifacts/v1.1/trials.json";
const RELEASE_URL = "https://deepswe.datacurve.ai/artifacts/v1.1/release.json";
const AGENT_URL = "https://github.com/SWE-agent/mini-swe-agent";
const SELECTION_SOURCE =
  "doc/benchmark-methodology.md#44-complete-deepswe-task-inventory";
const TASK_SOURCE_REPORT = "report-deepswe-v1.1-gpt56-sol-local-r01";
const MODEL_SOURCE = "gpt-5-6-sol";
const MODEL_NORMALIZED = "gpt-5.6-sol";
const EFFORTS = ["high", "medium"];
const REPLICATES = 4;
const AGENT = "mini-swe-agent";
const PROVIDER = "openai";
const AGENT_VERSION = null;
const VERSION_SENTINEL = "(not published in DeepSWE trials.json)";
const TASK_ORDER = [
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

function parseArgs(argv) {
  const args = {
    taskCount: 3,
    outputRoot: path.join(ROOT, "results", "debug"),
    trials: TRIALS_URL,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--task-count") args.taskCount = Number(argv[++index]);
    else if (value === "--output-root")
      args.outputRoot = path.resolve(argv[++index]);
    else if (value === "--trials") args.trials = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (
    !Number.isInteger(args.taskCount) ||
    args.taskCount < 1 ||
    args.taskCount > TASK_ORDER.length
  ) {
    throw new Error(
      `--task-count must be an integer from 1 to ${TASK_ORDER.length}`,
    );
  }
  return args;
}

async function loadBytes(location) {
  if (/^https?:\/\//u.test(location)) {
    const response = await fetch(location, {
      headers: { "user-agent": "tura-deep-swe-official-import" },
    });
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}: ${location}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(path.resolve(location));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function statusFor(trial) {
  return trial.passed === true ? "pass" : "fail";
}

function usageFor(trial) {
  return {
    inputTokens: trial.n_input_tokens,
    cacheInputTokens: trial.n_cache_tokens,
    outputTokens: trial.n_output_tokens,
    reasoningTokens: null,
    totalTokens: trial.n_input_tokens + trial.n_output_tokens,
  };
}

function officialTrialUrl(trialName) {
  return `https://deepswe.datacurve.ai/data/v1.1/trials/${encodeURIComponent(trialName)}`;
}

function sourceArtifactUrl(release, trialName, kind) {
  const pattern = release?.artifact_patterns?.[kind];
  if (!pattern || !release?.artifact_base_url) return null;
  return `${release.artifact_base_url.replace(/\/$/u, "")}/${pattern.replace("{trial_name}", encodeURIComponent(trialName))}`;
}

export function selectOfficialTrials(rows, taskIds) {
  const taskSet = new Set(taskIds);
  const selected = rows.filter(
    (row) =>
      taskSet.has(row.task_name) &&
      row.source === "deep-swe" &&
      row.eval_scope === "full" &&
      row.included_in_score === true &&
      row.model === MODEL_SOURCE &&
      row.harness === AGENT &&
      EFFORTS.includes(row.reasoning_effort),
  );

  const grouped = new Map();
  for (const row of selected) {
    const key = `${row.reasoning_effort}\u0000${row.task_name}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const result = [];
  for (const effort of EFFORTS) {
    for (const taskId of taskIds) {
      const key = `${effort}\u0000${taskId}`;
      const group = (grouped.get(key) ?? []).sort(
        (left, right) =>
          String(left.started_at).localeCompare(String(right.started_at)) ||
          left.trial_name.localeCompare(right.trial_name),
      );
      if (group.length !== REPLICATES) {
        throw new Error(
          `${effort}/${taskId}: expected ${REPLICATES} official trials, found ${group.length}`,
        );
      }
      group.forEach((trial, index) =>
        result.push({ ...trial, replicate: index + 1 }),
      );
    }
  }
  return result;
}

function agentIdFor(effort) {
  return `mini-swe-agent-gpt5.6-sol-${effort}`;
}

function runIdFor(taskId, effort, replicate) {
  return `${taskId}-mini-swe-agent-${effort}-run-${String(replicate).padStart(2, "0")}`;
}

function reportIdFor(effort, replicate) {
  return `report-deepswe-v1.1-gpt56-sol-mini-swe-agent-${effort}-r${String(replicate).padStart(2, "0")}`;
}

async function loadTaskSource(taskId) {
  const source = path.join(
    ROOT,
    "results",
    "debug",
    TASK_SOURCE_REPORT,
    taskId,
  );
  const [taskText, harnessText, promptText] = await Promise.all([
    readFile(path.join(source, "task.json"), "utf8"),
    readFile(path.join(source, "harness.json"), "utf8"),
    readFile(path.join(source, "task-first-round-prompt.txt"), "utf8"),
  ]);
  return {
    task: JSON.parse(taskText),
    harness: JSON.parse(harnessText),
    prompt: promptText,
  };
}

function agentMetadata(effort) {
  return {
    schema: "tura.benchmark.agent-metadata.v1",
    id: agentIdFor(effort),
    name: `mini-swe-agent GPT-5.6 SOL ${effort[0].toUpperCase()}${effort.slice(1)}`,
    provider: PROVIDER,
    mode: "mini-swe-agent",
    model: MODEL_NORMALIZED,
    effort,
    runtime: {
      packageName: AGENT,
      packageVersion: VERSION_SENTINEL,
      versionSource:
        "DeepSWE trials.json does not publish the mini-swe-agent version.",
      repository: AGENT_URL,
    },
  };
}

function cliMetadata(trial, effort) {
  return {
    schema: "tura.benchmark.cli-metadata.v1",
    software: {
      platform: "linux",
      arch: "x64",
      systemSoftwareVersion:
        "Modal-hosted DeepSWE run; exact image details are not present in trials.json",
      packageName: AGENT,
      packageVersion: VERSION_SENTINEL,
    },
    agent: {
      agentId: AGENT,
      agentName: AGENT,
      agentVersion: VERSION_SENTINEL,
      agentApplicationVersion: VERSION_SENTINEL,
      cliLaunchCommandName: AGENT,
      cliCommand:
        "(exact official launch command not published in DeepSWE trials.json)",
      pluginSkillGithubUrls: [],
      githubRepositoryUrl: AGENT_URL,
      releasePageUrl: null,
      releaseDownloadUrl: null,
      releaseSha256: null,
      model: MODEL_NORMALIZED,
      effort,
      versionResolution:
        "Agent identity is official; the installed mini-swe-agent version is unavailable in the published trial index.",
    },
    createdAt: trial.finished_at,
  };
}

function harnessResult(taskId, passed) {
  return {
    id: "deepswe-verifier",
    name: "DeepSWE verifier",
    description:
      "Binary official DeepSWE reward: all fail-to-pass tests must pass and all pass-to-pass regression tests must remain passing.",
    category: "DeepSWE verifier",
    harnessCodeLocation: {
      repository: "https://github.com/datacurve-ai/deep-swe",
      commit: "v1.1",
      path: `tasks/${taskId}/tests/grader.py`,
      symbol: "main",
      localPath: null,
    },
    sourceLocation: {
      repository: "https://github.com/datacurve-ai/deep-swe",
      commit: "v1.1",
      path: `tasks/${taskId}/tests/test.patch`,
      symbol: null,
      localPath: null,
    },
    status: passed ? "pass" : "fail",
    passed,
    failure: passed
      ? null
      : "Official DeepSWE binary verifier returned reward 0.",
  };
}

function harnessReport(trial, runId, reportId, agentId) {
  const passed = trial.passed === true;
  const result = harnessResult(trial.task_name, passed);
  result.breakdown = {
    failToPass: {
      passed: trial.f2p_passed,
      failed: trial.f2p_total - trial.f2p_passed,
      total: trial.f2p_total,
    },
    passToPass: {
      passed: trial.p2p_passed,
      failed: trial.p2p_total - trial.p2p_passed,
      total: trial.p2p_total,
    },
    partial: trial.partial,
  };
  return {
    schema: "tura.benchmark.harness-report.v2",
    id: `${runId}-harness-report`,
    runId,
    taskId: trial.task_name,
    agentId,
    category: "debug",
    report: reportId,
    taskContractPath: "../../task.json",
    harnessContractPath: "../../harness.json",
    status: statusFor(trial),
    score: {
      passed: passed ? 1 : 0,
      failed: passed ? 0 : 1,
      total: 1,
      ratio: passed ? 1 : 0,
      label: passed ? "1/1" : "0/1",
    },
    results: [result],
    artifacts: { stdoutPath: null, stderrPath: null, harnessDirectory: null },
    legacy: {
      source: "DeepSWE v1.1 trials.json",
      trialName: trial.trial_name,
      reward: trial.reward,
      scoreValue: trial.score_value,
      outcome: trial.outcome,
      metricsSource: trial.metrics_source,
      verifierFiles: trial.verifier_files,
    },
  };
}

function sourceMetrics(trial, release) {
  const usage = usageFor(trial);
  return {
    url: officialTrialUrl(trial.trial_name),
    model: MODEL_NORMALIZED,
    steps: trial.n_agent_steps,
    costUsd: trial.cost_usd,
    inputTokens: usage.inputTokens,
    cacheInputTokens: usage.cacheInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    peakContext: trial.peak_context_tokens,
    durationSeconds: trial.agent_duration_seconds,
    rawArtifactStatus:
      "Normalized from the official DeepSWE trial summary. Detailed trajectory, command, and patch payloads were not imported; no synthetic rounds or commands were created.",
    officialArtifacts: {
      trajectory: sourceArtifactUrl(release, trial.trial_name, "trajectory"),
      modelPatch: sourceArtifactUrl(release, trial.trial_name, "model_patch"),
      agentLog: sourceArtifactUrl(release, trial.trial_name, "agent_log"),
    },
  };
}

function taskReport(trial, runId, reportId, agentId, prompt, release) {
  const usage = usageFor(trial);
  return {
    schema: "tura.benchmark.task-report.v1",
    runId,
    category: "debug",
    report: reportId,
    task: trial.task_name,
    agent: agentId,
    taskId: trial.task_name,
    agentId,
    status: statusFor(trial),
    createdAt: trial.finished_at,
    result: {
      status: statusFor(trial),
      score: trial.passed ? 100 : 0,
      harness: { passed: trial.passed ? 1 : 0, total: 1 },
    },
    source: sourceMetrics(trial, release),
    prompt: {
      path: "raw-first-round-prompt.txt",
      format: "markdown",
      text: prompt,
    },
    metadata: {
      startedAt: trial.started_at,
      endedAt: trial.finished_at,
      agentVersion: VERSION_SENTINEL,
      agentCliCommand:
        "(exact official launch command not published in DeepSWE trials.json)",
    },
    usage: {
      ...usage,
      providerDurationMs: trial.agent_duration_seconds * 1000,
      llmRoundCount: trial.n_agent_steps,
    },
    harnessScore: trial.passed ? 1 : 0,
    harness: { passed: trial.passed ? 1 : 0, total: 1 },
    rounds: [],
    sourceSummaryPath: "metadata/source-trial.json",
  };
}

function webRun(trial, runId, reportId, agent, task, prompt, release) {
  const result = harnessResult(trial.task_name, trial.passed === true);
  return {
    schema: "tura.benchmark.web-run.v1",
    id: runId,
    task: trial.task_name,
    agent: agent.id,
    taskName: task.title,
    sessionName: runId,
    title: runId,
    subtitle: "Official DeepSWE v1.1 mini-swe-agent trial summary import.",
    prompt: { text: prompt, sourcePath: "raw-first-round-prompt.txt" },
    source: sourceMetrics(trial, release),
    run: {
      status: statusFor(trial),
      agent: AGENT,
      provider: PROVIDER,
      runtimeModel: MODEL_NORMALIZED,
      mode: "mini-swe-agent",
      startedAt: trial.started_at,
      completedAt: trial.finished_at,
      repository: task.source.repository,
      branch: task.source.commit,
    },
    rounds: [],
    harness: [
      {
        id: result.id,
        status: result.status,
        assertion: result.name,
        description: result.description,
        evidence: `F2P ${trial.f2p_passed}/${trial.f2p_total}; P2P ${trial.p2p_passed}/${trial.p2p_total}`,
        category: result.category,
        failure: result.failure,
        harnessCodeLocation: result.harnessCodeLocation,
        sourceLocation: result.sourceLocation,
      },
    ],
    metadata: {
      common: {
        schema: "tura.benchmark.common-metadata.v1",
        category: "debug",
        report: reportId,
        taskId: trial.task_name,
        runId,
        benchmark: "DeepSWE",
        benchmarkVersion: "v1.1",
      },
      agent,
      system: null,
      environment: {
        operatingSystem: "Linux",
        architecture: "x64",
        runtime: { language: task.source.language, projectVersion: "" },
        browser: null,
      },
      custom: {
        source: "DeepSWE v1.1 official trials.json",
        trialName: trial.trial_name,
        sourceModel: trial.model,
        config: trial.config,
        metricsSource: trial.metrics_source,
        officialTrialUrl: officialTrialUrl(trial.trial_name),
        detailedArtifactsImported: false,
        sourceFlags: {
          hasTrajectory: trial.has_trajectory,
          hasAgentLog: trial.has_agent_log,
          hasModelPatch: trial.has_model_patch,
          hasVerifierOutput: trial.has_verifier_output,
        },
      },
      result_tab: "debug",
      result_tabs: [],
      contract_paths: {
        task: "../../task.json",
        harness: "../../harness.json",
        harnessReport: "harness-report.json",
        taskReport: "task-report.json",
        cliMetadataPath: "metadata/contracts/cli-metadata.json",
      },
    },
  };
}

function runSummary(trial, runId, effort) {
  return {
    schema: "tura.benchmark.normalized-summary.v1",
    runId,
    taskId: trial.task_name,
    agentId: agentIdFor(effort),
    model: MODEL_NORMALIZED,
    effort,
    sourceBatch: reportIdFor(effort, trial.replicate),
    elapsedMs: trial.trial_duration_seconds * 1000,
    exitCode: trial.errored ? 1 : 0,
    usage: usageFor(trial),
    events: {
      officialAgentSteps: trial.n_agent_steps,
      detailedArtifactsImported: false,
      officialTrial: true,
    },
    source: {
      trialName: trial.trial_name,
      url: officialTrialUrl(trial.trial_name),
      costUsd: trial.cost_usd,
      passed: trial.passed,
      errored: trial.errored,
      outcome: trial.outcome,
    },
  };
}

function contractManifest(runId) {
  return {
    schema: "tura.benchmark.contract-manifest.v1",
    runId,
    files: {
      run: "metadata/contracts/benchmark-web-run.json",
      taskReport: "metadata/contracts/task-report.json",
      agentRounds: "metadata/contracts/agent-rounds.jsonl",
      rounds: [],
      cliMetadata: "metadata/contracts/cli-metadata.json",
      harnessReport: "metadata/contracts/harness-report.json",
      taskContract: "../../task.json",
      harnessContract: "../../harness.json",
      agentMetadata: "metadata/contracts/agent-metadata.json",
      sourceTrial: "metadata/source-trial.json",
    },
    naming: {
      runDirectory: "{task}-mini-swe-agent-{effort}-run-{NN}",
      roundFile: "round-{NNNN}.json",
    },
  };
}

async function writeRun(outputRoot, trial, taskSource, release) {
  const effort = trial.reasoning_effort;
  const reportId = reportIdFor(effort, trial.replicate);
  const runId = runIdFor(trial.task_name, effort, trial.replicate);
  const agentId = agentIdFor(effort);
  const runRoot = path.join(
    outputRoot,
    reportId,
    trial.task_name,
    AGENT,
    runId,
  );
  const contracts = path.join(runRoot, "metadata", "contracts");
  await mkdir(contracts, { recursive: true });
  const agent = agentMetadata(effort);
  const files = [
    [path.join(runRoot, "raw-first-round-prompt.txt"), taskSource.prompt],
    [path.join(runRoot, "metadata", "source-trial.json"), stableJson(trial)],
    [
      path.join(runRoot, "metadata", "summary.json"),
      stableJson(runSummary(trial, runId, effort)),
    ],
    [path.join(contracts, "agent-metadata.json"), stableJson(agent)],
    [
      path.join(contracts, "cli-metadata.json"),
      stableJson(cliMetadata(trial, effort)),
    ],
    [
      path.join(contracts, "harness-report.json"),
      stableJson(harnessReport(trial, runId, reportId, agentId)),
    ],
    [
      path.join(contracts, "task-report.json"),
      stableJson(
        taskReport(trial, runId, reportId, agentId, taskSource.prompt, release),
      ),
    ],
    [
      path.join(contracts, "benchmark-web-run.json"),
      stableJson(
        webRun(
          trial,
          runId,
          reportId,
          agent,
          taskSource.task,
          taskSource.prompt,
          release,
        ),
      ),
    ],
    [
      path.join(contracts, "contract-manifest.json"),
      stableJson(contractManifest(runId)),
    ],
    [path.join(contracts, "agent-rounds.jsonl"), ""],
  ];
  await Promise.all(
    files.map(([target, content]) => writeFile(target, content, "utf8")),
  );
  return {
    runId,
    taskId: trial.task_name,
    agentId,
    effort,
    replicate: trial.replicate,
    trialName: trial.trial_name,
    status: statusFor(trial),
    path: path.relative(ROOT, runRoot).replaceAll(path.sep, "/"),
  };
}

function aggregate(trials, effort) {
  const rows = trials.filter((trial) => trial.reasoning_effort === effort);
  return {
    effort,
    runs: rows.length,
    passes: rows.filter((trial) => trial.passed).length,
    inputTokens: rows.reduce((sum, trial) => sum + trial.n_input_tokens, 0),
    cacheInputTokens: rows.reduce(
      (sum, trial) => sum + trial.n_cache_tokens,
      0,
    ),
    outputTokens: rows.reduce((sum, trial) => sum + trial.n_output_tokens, 0),
    totalTokens: rows.reduce(
      (sum, trial) => sum + trial.n_input_tokens + trial.n_output_tokens,
      0,
    ),
    costUsd: rows.reduce((sum, trial) => sum + trial.cost_usd, 0),
    agentSteps: rows.reduce((sum, trial) => sum + trial.n_agent_steps, 0),
  };
}

export async function importOfficialSubset(options) {
  const taskIds = TASK_ORDER.slice(0, options.taskCount);
  const trialBytes = await loadBytes(options.trials);
  const trialsSha256 = createHash("sha256").update(trialBytes).digest("hex");
  const trialDocument = JSON.parse(trialBytes.toString("utf8"));
  const release = JSON.parse((await loadBytes(RELEASE_URL)).toString("utf8"));
  const trials = selectOfficialTrials(trialDocument.rows, taskIds);
  const taskSources = new Map(
    await Promise.all(
      taskIds.map(async (taskId) => [taskId, await loadTaskSource(taskId)]),
    ),
  );

  for (const effort of EFFORTS) {
    for (let replicate = 1; replicate <= REPLICATES; replicate += 1) {
      await rm(path.join(options.outputRoot, reportIdFor(effort, replicate)), {
        recursive: true,
        force: true,
      });
    }
  }

  const reportRuns = new Map();
  for (const trial of trials) {
    const taskSource = taskSources.get(trial.task_name);
    const reportId = reportIdFor(trial.reasoning_effort, trial.replicate);
    const reportRoot = path.join(options.outputRoot, reportId);
    const taskRoot = path.join(reportRoot, trial.task_name);
    await mkdir(taskRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(taskRoot, "task.json"),
        stableJson(taskSource.task),
        "utf8",
      ),
      writeFile(
        path.join(taskRoot, "harness.json"),
        stableJson(taskSource.harness),
        "utf8",
      ),
      writeFile(
        path.join(taskRoot, "task-first-round-prompt.txt"),
        taskSource.prompt,
        "utf8",
      ),
    ]);
    const run = await writeRun(options.outputRoot, trial, taskSource, release);
    const runs = reportRuns.get(reportId) ?? [];
    runs.push(run);
    reportRuns.set(reportId, runs);
  }

  const reportAudit = [];
  for (const effort of EFFORTS) {
    for (let replicate = 1; replicate <= REPLICATES; replicate += 1) {
      const reportId = reportIdFor(effort, replicate);
      const runs = (reportRuns.get(reportId) ?? []).sort((left, right) =>
        left.taskId.localeCompare(right.taskId),
      );
      if (runs.length !== taskIds.length)
        throw new Error(
          `${reportId}: expected ${taskIds.length} runs, found ${runs.length}`,
        );
      const manifest = {
        schema: "tura.benchmark.deepswe-official-subset.v1",
        id: reportId,
        category: "debug",
        benchmark: "datacurve-ai/deep-swe",
        benchmarkVersion: "v1.1",
        model: MODEL_NORMALIZED,
        effort,
        agent: AGENT,
        agentVersion: AGENT_VERSION,
        replicate,
        selection: {
          method: `First ${taskIds.length} tasks in the published Tura DeepSWE 20-task inventory order.`,
          taskIds,
        },
        taskCount: taskIds.length,
        runCount: runs.length,
        source: {
          selection: SELECTION_SOURCE,
          trials: TRIALS_URL,
          release: RELEASE_URL,
          agent: AGENT_URL,
          agentVersion: AGENT_VERSION,
          trialsSha256,
        },
        runs,
      };
      await writeFile(
        path.join(options.outputRoot, reportId, "manifest.json"),
        stableJson(manifest),
        "utf8",
      );
      reportAudit.push({
        report: reportId,
        effort,
        replicate,
        runs: runs.length,
      });
    }
  }

  const auditName = `deepswe-v1.1-gpt56-sol-mini-swe-agent-first${taskIds.length}-audit.json`;
  const audit = {
    schema: "tura.benchmark.deepswe-official-subset-audit.v1",
    benchmark: "datacurve-ai/deep-swe",
    benchmarkVersion: "v1.1",
    model: MODEL_NORMALIZED,
    agent: AGENT,
    agentVersion: AGENT_VERSION,
    taskIds,
    efforts: EFFORTS,
    replicates: REPLICATES,
    taskCount: taskIds.length,
    runCount: trials.length,
    reportCount: reportAudit.length,
    trialsSha256,
    detailedArtifactImported: 0,
    summaryOnlyRuns: trials.length,
    aggregates: EFFORTS.map((effort) => aggregate(trials, effort)),
    reports: reportAudit,
    source: {
      trials: TRIALS_URL,
      release: RELEASE_URL,
      agent: AGENT_URL,
      selection: SELECTION_SOURCE,
    },
    note: "Official trial summaries were normalized without inventing unavailable reasoning-token subsets, round payloads, commands, patches, or an agent version. Source flags and artifact URLs are retained for future enrichment.",
  };
  await writeFile(
    path.join(options.outputRoot, auditName),
    stableJson(audit),
    "utf8",
  );
  return audit;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const audit = await importOfficialSubset(options);
  process.stdout.write(
    stableJson({
      outputRoot: path
        .relative(ROOT, options.outputRoot)
        .replaceAll(path.sep, "/"),
      tasks: audit.taskCount,
      runs: audit.runCount,
      reports: audit.reportCount,
      trialsSha256: audit.trialsSha256,
    }),
  );
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain)
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
