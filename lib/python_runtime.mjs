import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function projectPython(root, env = process.env) {
  if (env.PYTHON) return env.PYTHON;
  const executable = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  return fs.existsSync(executable) ? executable : "python";
}
