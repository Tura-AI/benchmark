#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

import {
  CURRENT_RESULT_SCHEMA_VERSION,
  migrateResultFile,
  resultSchemaState,
} from "../lib/result_schema.mjs";

const args = parse(process.argv.slice(2));
const command = args._[0];
let output;
if (command === "validate") {
  const input = required(args._[1], "input file");
  output = resultSchemaState(JSON.parse(fs.readFileSync(input, "utf8")));
  if (
    ["rejected", "unsupported-version", "pending-normalization"].includes(
      output.state,
    )
  )
    process.exitCode = 1;
} else if (command === "normalize") {
  output = migrateResultFile(
    required(args._[1], "input file"),
    required(args._[2], "output file"),
    { targetVersion: CURRENT_RESULT_SCHEMA_VERSION },
  );
} else if (command === "migrate") {
  output = migrateResultFile(
    required(args._[1], "input file"),
    required(args._[2], "output file"),
    { targetVersion: required(args.target, "--target") },
  );
} else {
  console.error(
    "Usage: node scripts/result_schema.mjs validate INPUT | normalize INPUT OUTPUT | migrate INPUT OUTPUT --target VERSION",
  );
  process.exit(2);
}
console.log(JSON.stringify(output, null, 2));

function parse(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--target") parsed.target = argv[++index];
    else parsed._.push(argv[index]);
  }
  return parsed;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}
