#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  importRawSubmission,
  normalizeSubmission,
  publishSubmission,
  submissionStatus,
  verifySubmission,
} from "../lib/result_intake.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parse(process.argv.slice(2));
const command = args._[0];
let result;
if (command === "import") {
  requireValue(args.source, "--source");
  requireValue(args.manifest, "--manifest");
  result = importRawSubmission(
    root,
    args.source,
    JSON.parse(fs.readFileSync(path.resolve(args.manifest), "utf8")),
  );
} else if (command === "normalize") {
  result = normalizeSubmission(root, requireValue(args.id, "--id"));
} else if (command === "verify") {
  result = verifySubmission(root, requireValue(args.id, "--id"));
} else if (command === "publish") {
  result = publishSubmission(
    root,
    requireValue(args.id, "--id"),
    requireValue(args.destination, "--destination"),
  );
} else if (command === "status") {
  result = submissionStatus(root, requireValue(args.id, "--id"));
} else {
  console.error(
    "Usage: node scripts/intake.mjs import --source DIR --manifest FILE | normalize|verify|status --id ID | publish --id ID --destination results/...",
  );
  process.exit(2);
}
console.log(JSON.stringify(result, null, 2));

function parse(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) result._.push(item);
    else result[item.slice(2)] = argv[++index];
  }
  return result;
}

function requireValue(value, flag) {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
