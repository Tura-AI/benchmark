#!/usr/bin/env node
import fs from "node:fs";
import {
  loadReconciliationInput,
  reconcileObservabilityRun,
} from "../lib/observability_reconciliation.mjs";

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile) {
  throw new Error("usage: reconcile-observability INPUT.json [OUTPUT.json]");
}

const report = reconcileObservabilityRun(loadReconciliationInput(inputFile));
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outputFile) fs.writeFileSync(outputFile, text, "utf8");
else process.stdout.write(text);
