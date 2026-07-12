import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function npmInvocation(env = process.env) {
  const candidates = [
    env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => fs.existsSync(candidate));
  if (cli) return { command: process.execPath, args: [cli] };
  return {
    command: process.platform === "win32" ? "cmd.exe" : "npm",
    args: process.platform === "win32" ? ["/d", "/s", "/c", "npm"] : [],
  };
}
