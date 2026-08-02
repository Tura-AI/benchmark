#!/usr/bin/env node
import fs from "node:fs";
import {
  createMcpReplayFixture,
  replayMcpSession,
  stableJson,
  verifyByteIdenticalFixture,
} from "../lib/mcp_replay.mjs";

const [command = "run", ...args] = process.argv.slice(2);
const options = parseArgs(args);

if (command === "fixture") {
  emit(createMcpReplayFixture(options), options.output);
} else if (command === "verify") {
  const result = verifyByteIdenticalFixture(options);
  emit(result, options.output);
  if (!result.identical) process.exitCode = 1;
} else if (command === "run") {
  const report = await replayMcpSession({
    ...options,
    scenario: options.scenario,
    transient_failures: optionList(options.transient_failures),
  });
  emit(report, options.output);
  if (!report.metrics.success) process.exitCode = 1;
} else {
  throw new Error(
    `usage: mcp-replay <fixture|verify|run> [--family github] [--seed 1729] [--record-count 137] [--page-size 25] [--scenario NAME] [--transient-failures id,...] [--output FILE]`,
  );
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] === undefined) {
      throw new Error(`invalid option: ${key}`);
    }
    parsed[key.slice(2).replaceAll("-", "_")] = values[index + 1];
  }
  return parsed;
}

function optionList(value) {
  return value ? String(value).split(",").filter(Boolean) : [];
}

function emit(value, output) {
  const text = stableJson(value);
  if (output) fs.writeFileSync(output, text, "utf8");
  else process.stdout.write(text);
}
