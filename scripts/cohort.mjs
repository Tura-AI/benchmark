#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

import {
  loadCohortContract,
  minimumDetectableEffect,
} from "../lib/cohort_contract.mjs";

const [command, file] = process.argv.slice(2);
if (command === "power") {
  const input = file
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : JSON.parse(await readStdin());
  console.log(
    JSON.stringify(
      { minimum_detectable_effect: minimumDetectableEffect(input) },
      null,
      2,
    ),
  );
} else if (command === "validate" && file) {
  const { contractPath } = loadCohortContract(file);
  console.log(JSON.stringify({ valid: true, contract: contractPath }, null, 2));
} else {
  console.error(
    "Usage: node scripts/cohort.mjs power [inputs.json] | validate CONTRACT.json",
  );
  process.exitCode = 2;
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}
