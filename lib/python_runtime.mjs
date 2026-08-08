import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function projectPython(root, env = process.env) {
  return resolvePythonInterpreter(root, { env }).path;
}

export function resolvePythonInterpreter(root, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const findExecutable =
    options.findExecutable ||
    ((command) => executableOnPath(command, platform));
  const inspectVersion =
    options.inspectVersion || ((command) => pythonVersion(command, root));
  const venv = path.resolve(
    root,
    ".venv",
    platform === "win32" ? "Scripts" : "bin",
    platform === "win32" ? "python.exe" : "python",
  );
  const configured = env.TURA_BENCHMARK_PYTHON || env.PYTHON;
  const candidates = [
    { command: venv, source: "project-virtualenv", direct: true },
    configured
      ? {
          command: configured,
          source: env.TURA_BENCHMARK_PYTHON
            ? "environment:TURA_BENCHMARK_PYTHON"
            : "environment:PYTHON",
          direct: path.isAbsolute(configured) || /[\\/]/.test(configured),
        }
      : null,
    { command: "python3", source: "path:python3", direct: false },
    { command: "python", source: "path:python", direct: false },
  ].filter(Boolean);
  const unsupported = [];

  for (const candidate of candidates) {
    const resolved = candidate.direct
      ? path.resolve(root, candidate.command)
      : findExecutable(candidate.command);
    if (!resolved || !exists(resolved)) continue;
    const version = inspectVersion(resolved);
    if (!isSupportedPython(version)) {
      unsupported.push(`${resolved} (${version || "unknown version"})`);
      continue;
    }
    return {
      path: path.resolve(resolved),
      version,
      source: candidate.source,
    };
  }

  const detail = unsupported.length
    ? ` Unsupported candidates: ${unsupported.join(", ")}.`
    : "";
  throw new Error(
    `Python 3.11 or newer was not found. Create ${venv}, set TURA_BENCHMARK_PYTHON to an interpreter path, or install python3/python on PATH.${detail}`,
  );
}

function executableOnPath(command, platform) {
  const result =
    platform === "win32"
      ? spawnSync("where.exe", [command], {
          encoding: "utf8",
          windowsHide: true,
        })
      : spawnSync("sh", ["-lc", `command -v -- ${shellQuote(command)}`], {
          encoding: "utf8",
        });
  if (result.status !== 0) return null;
  return String(result.stdout || "")
    .trim()
    .split(/\r?\n/, 1)[0];
}

function pythonVersion(command, root) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const match = String(result.stdout || result.stderr || "").match(
    /Python\s+(\d+\.\d+(?:\.\d+)?)/i,
  );
  return match?.[1] || null;
}

function isSupportedPython(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 11);
}

function shellQuote(value) {
  assert(!String(value).includes("\0"), "invalid executable name");
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
