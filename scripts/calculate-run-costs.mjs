import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsRoot = path.join(repoRoot, "results");
const reportPath = path.join(repoRoot, "reports", "run-costs.json");

const PRICING_SOURCE_URL = "https://developers.openai.com/api/docs/pricing";
const PRICES_USD_PER_1M_TOKENS = {
  "gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 },
  "openai/gpt-5.5": { input: 5.00, cachedInput: 0.50, output: 30.00 }
};

const slash = (value) => value.replace(/\\/g, "/");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function listEntries(dir) {
  if (!(await exists(dir))) return [];
  return readdir(dir, { withFileTypes: true });
}

async function walk(dir, predicate, output = []) {
  for (const entry of await listEntries(dir)) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(file, predicate, output);
    } else if (predicate(file, entry)) {
      output.push(file);
    }
  }
  return output;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonLines(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeModel(model) {
  return String(model || "").toLowerCase().trim();
}

function meaningfulString(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => value && value.toLowerCase() !== "unknown") || "";
}

function priceForModel(model) {
  return PRICES_USD_PER_1M_TOKENS[normalizeModel(model)] || null;
}

function emptyUsage() {
  return {
    inputTokens: 0,
    cacheInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };
}

function addUsage(total, usage = {}) {
  total.inputTokens += Number(usage.input_tokens ?? usage.inputTokens ?? 0);
  total.cacheInputTokens += Number(usage.cached_input_tokens ?? usage.cacheInputTokens ?? 0);
  total.outputTokens += Number(usage.output_tokens ?? usage.outputTokens ?? 0);
  total.reasoningTokens += Number(usage.reasoning_tokens ?? usage.reasoningTokens ?? usage.reasoning_output_tokens ?? 0);
  total.cacheWriteTokens += Number(usage.cache_write_tokens ?? usage.cacheWriteTokens ?? 0);
  total.totalTokens += Number(usage.total_tokens ?? usage.totalTokens ?? 0);
}

async function usageFromProviderCalls(file) {
  const total = emptyUsage();
  let calls = 0;
  let model = "";

  for (const call of await readJsonLines(file)) {
    const usage = call?.metrics?.usage || call?.response?.usage || null;
    model ||= meaningfulString(call?.model, call?.metrics?.model, call?.response?.model);
    if (!usage) continue;
    calls += 1;
    addUsage(total, usage);
  }

  return calls ? { usage: total, calls, model } : null;
}

function usageFromContract(run) {
  const source = run.source || {};
  return {
    usage: {
      inputTokens: Number(source.inputTokens || 0),
      cacheInputTokens: Number(source.cacheInputTokens || 0),
      outputTokens: Number(source.outputTokens || 0),
      reasoningTokens: Number(source.reasoningTokens || 0),
      cacheWriteTokens: Number(source.cacheWriteTokens || 0),
      totalTokens: Number(source.totalTokens || 0)
    },
    calls: 0
  };
}

function calculateCost(usage, rates) {
  const cachedInputTokens = Math.min(usage.cacheInputTokens || 0, usage.inputTokens || 0);
  const billableInputTokens = Math.max(0, (usage.inputTokens || 0) - cachedInputTokens);
  const inputCost = (billableInputTokens / 1_000_000) * rates.input;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * rates.cachedInput;
  const outputCost = ((usage.outputTokens || 0) / 1_000_000) * rates.output;
  const totalCostUsd = inputCost + cachedInputCost + outputCost;

  return {
    currency: "USD",
    pricingSource: "model-rate-map",
    pricingSourceUrl: PRICING_SOURCE_URL,
    ratesUsdPerMillionTokens: rates,
    billableInputTokens,
    cachedInputTokens,
    outputTokens: usage.outputTokens || 0,
    inputCostUsd: +inputCost.toFixed(6),
    cachedInputCostUsd: +cachedInputCost.toFixed(6),
    outputCostUsd: +outputCost.toFixed(6),
    totalCostUsd: +totalCostUsd.toFixed(6)
  };
}

async function discoverContracts() {
  return walk(resultsRoot, (file) => path.basename(file) === "benchmark-web-run.json")
    .then((files) => files.sort((left, right) => slash(left).localeCompare(slash(right))));
}

async function calculateRunCost(contractPath) {
  const run = await readJson(contractPath);
  const runRoot = path.dirname(path.dirname(path.dirname(contractPath)));
  const providerPath = path.join(runRoot, "metadata", "provider-calls-full.jsonl");
  const providerUsage = await usageFromProviderCalls(providerPath);
  const model = meaningfulString(
    providerUsage?.model,
    run.source?.model,
    run.run?.model,
    run.run?.runtimeModel,
    run.metadata?.cliMetadata?.agent?.agentVersion,
    run.metadata?.cliMetadata?.agent?.agentApplicationVersion
  );
  const rates = priceForModel(model);
  const usageSource = providerUsage ? "provider-calls-full.jsonl" : "benchmark-web-run.source";
  const usage = providerUsage || usageFromContract(run);

  if (!rates) {
    run.source = {
      ...run.source,
      model,
      costUsd: 0,
      cost: {
        currency: "USD",
        pricingSource: "missing-model-rate",
        pricingSourceUrl: PRICING_SOURCE_URL,
        model,
        usageSource
      }
    };
  } else {
    const cost = calculateCost(usage.usage, rates);
    run.source = {
      ...run.source,
      model,
      inputTokens: usage.usage.inputTokens,
      cacheInputTokens: usage.usage.cacheInputTokens,
      outputTokens: usage.usage.outputTokens,
      reasoningTokens: usage.usage.reasoningTokens,
      cacheWriteTokens: usage.usage.cacheWriteTokens,
      totalTokens: usage.usage.totalTokens || usage.usage.inputTokens + usage.usage.outputTokens,
      costUsd: cost.totalCostUsd,
      cost: {
        ...cost,
        model,
        usageSource,
        providerCalls: usage.calls
      }
    };
  }

  await writeJson(contractPath, run);
  return {
    runId: run.id,
    agent: run.agent,
    model,
    usageSource,
    costUsd: run.source.costUsd,
    inputTokens: run.source.inputTokens,
    cacheInputTokens: run.source.cacheInputTokens,
    outputTokens: run.source.outputTokens,
    providerCalls: run.source.cost?.providerCalls || 0,
    contractPath: slash(path.relative(repoRoot, contractPath))
  };
}

async function main() {
  const contracts = await discoverContracts();
  const runs = [];

  for (const contractPath of contracts) {
    runs.push(await calculateRunCost(contractPath));
  }

  const report = {
    schema: "tura.benchmark.run-costs.v1",
    generatedBy: "scripts/calculate-run-costs.mjs",
    pricingSourceUrl: PRICING_SOURCE_URL,
    ratesUsdPerMillionTokens: PRICES_USD_PER_1M_TOKENS,
    totals: {
      runs: runs.length,
      costUsd: +runs.reduce((sum, run) => sum + Number(run.costUsd || 0), 0).toFixed(6)
    },
    runs
  };

  await writeJson(reportPath, report);
  console.log(`Calculated costs for ${runs.length} runs.`);
  console.log(`- total cost USD: ${report.totals.costUsd}`);
  console.log(`- ${path.relative(repoRoot, reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
