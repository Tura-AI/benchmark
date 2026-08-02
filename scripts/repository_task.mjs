#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import {
  collectRepositoryTaskArtifacts,
  loadRepositoryTask,
  repositoryTaskPlan,
  runRepositoryTask,
  validateRepositoryTaskRun,
} from "../lib/repository_task.mjs";

const args = parse(process.argv.slice(2));
const command = args._[0];
const contractFile = required(args.contract, "--contract");
const { contract, contractPath } = loadRepositoryTask(contractFile);
const contractRoot = path.dirname(contractPath);
let result;
if (command === "plan") {
  result = repositoryTaskPlan(contract, { contractRoot });
} else if (command === "run") {
  result = await runRepositoryTask(contract, {
    arm: required(args.arm, "--arm"),
    outputRoot: required(args.output, "--output"),
    contractRoot,
  });
} else if (command === "validate") {
  result = await validateRepositoryTaskRun(contract, {
    workspace: required(args.workspace, "--workspace"),
    contractRoot,
    env: process.env,
  });
} else if (command === "collect") {
  result = collectRepositoryTaskArtifacts(
    contract,
    required(args.workspace, "--workspace"),
    required(args.output, "--output"),
  );
} else {
  console.error(
    "Usage: node scripts/repository_task.mjs plan|run|validate|collect --contract FILE [--arm baseline|treatment] [--workspace DIR] [--output DIR]",
  );
  process.exit(2);
}
console.log(JSON.stringify(result, null, 2));

function parse(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) parsed._.push(argv[index]);
    else parsed[argv[index].slice(2)] = argv[++index];
  }
  return parsed;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}
