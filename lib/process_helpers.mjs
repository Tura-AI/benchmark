import process from "node:process";
import { spawnSync } from "node:child_process";

export function isolatedProcessOptions(options = {}) {
  if (process.platform === "win32") {
    return {
      ...options,
      detached: false,
      windowsHide: options.windowsHide ?? true,
    };
  }
  return { ...options, detached: true };
}

export function killProcessTree(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-Number(pid), "SIGTERM");
  } catch {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
}

export function endStream(stream) {
  if (!stream || stream.destroyed || stream.writableEnded) return;
  stream.end();
}
