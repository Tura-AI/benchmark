#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const canonicalRepository = "https://github.com/Tura-AI/benchmark";
const canonicalSlug = "Tura-AI/benchmark";
const write = process.argv.includes("--write");
const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split("\0")
  .filter(Boolean);

const textExtensions = new Set([
  "",
  ".cjs",
  ".conf",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".mjs",
  ".mts",
  ".ps1",
  ".py",
  ".ts",
  ".txt",
]);
const replacements = [
  [
    /https:\/\/github\.com\/Tura-AI\/tura-benchmark(?:\.git)?/g,
    canonicalRepository,
  ],
  [/https:\/\/github\.com\/Tura-AI\/tura-eval(?:\.git)?/g, canonicalRepository],
  [/Tura-AI\/tura-benchmark/g, canonicalSlug],
  [/Tura-AI\/tura-eval/g, canonicalSlug],
  [/("repository"\s*:\s*")Tura-AI\/tura("\s*[,}])/g, `$1${canonicalSlug}$2`],
  [
    /("repository"\s*:\s*")https:\/\/github\.com\/Tura-AI\/tura\.git("\s*[,}])/g,
    `$1${canonicalRepository}$2`,
  ],
  [/("path"\s*:\s*")benchmark\/(tasks\/)/g, "$1$2"],
];
const stalePatterns = [
  /Tura-AI\/tura-benchmark/i,
  /Tura-AI\/tura-eval/i,
  /"repository"\s*:\s*"Tura-AI\/tura"/i,
  /"repository"\s*:\s*"https:\/\/github\.com\/Tura-AI\/tura\.git"/i,
  /"path"\s*:\s*"benchmark\/tasks\//i,
];

let changedFiles = 0;
let changedReferences = 0;
const stale = [];

for (const relativePath of repositoryFiles) {
  if (!textExtensions.has(path.extname(relativePath).toLowerCase())) continue;
  const absolutePath = path.join(repoRoot, relativePath);
  let source;
  try {
    source = fs.readFileSync(absolutePath, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;

  let updated = source;
  for (const [pattern, replacement] of replacements) {
    const matches = updated.match(pattern);
    if (matches) changedReferences += matches.length;
    updated = updated.replace(pattern, replacement);
  }
  if (write && updated !== source) {
    fs.writeFileSync(absolutePath, updated, "utf8");
    changedFiles += 1;
  }

  const audited = write ? updated : source;
  if (stalePatterns.some((pattern) => pattern.test(audited)))
    stale.push(relativePath);
}

console.log(
  JSON.stringify(
    {
      canonicalRepository,
      mode: write ? "write" : "check",
      changedFiles,
      changedReferences,
      staleFiles: stale.length,
    },
    null,
    2,
  ),
);

if (stale.length) {
  console.error(stale.slice(0, 50).join("\n"));
  process.exitCode = 1;
}
