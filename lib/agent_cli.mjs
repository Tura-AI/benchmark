import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

export function agentHome() {
  return process.env.USERPROFILE || process.env.HOME || ""
}

export function findClaudeExe() {
  return process.env.COMMAND_RUN_AGENT_CLAUDE_EXE || "claude"
}

export function findPiExe() {
  if (process.env.COMMAND_RUN_AGENT_PI_EXE) return process.env.COMMAND_RUN_AGENT_PI_EXE
  const cli = defaultPiCli()
  return cli && fs.existsSync(cli) ? process.execPath : process.platform === "win32" ? "pi.cmd" : "pi"
}

export function findOpencodeExe() {
  if (process.env.COMMAND_RUN_AGENT_OPENCODE_EXE) return process.env.COMMAND_RUN_AGENT_OPENCODE_EXE
  const executable = defaultOpencodeExe()
  return executable && fs.existsSync(executable) ? executable : process.platform === "win32" ? "opencode.cmd" : "opencode"
}

export function claudeCodeArgs(prompt, options = {}) {
  return [
    "--print",
    "--model",
    options.model || process.env.COMMAND_RUN_AGENT_CLAUDE_MODEL || "opus",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    prompt,
  ]
}

export function piAgentArgs(prompt, options = {}) {
  const model = options.model || process.env.COMMAND_RUN_AGENT_PI_MODEL || process.env.COMMAND_RUN_AGENT_CODEX_MODEL || "openai-codex/gpt-5.5"
  const normalizedModel = model.includes("/") ? model : `openai-codex/${model}`
  const thinking = options.reasoning || process.env.COMMAND_RUN_AGENT_REASONING_EFFORT || "medium"
  const cli = process.env.COMMAND_RUN_AGENT_PI_CLI_JS || (process.env.COMMAND_RUN_AGENT_PI_EXE ? "" : defaultPiCli())
  const prefix = cli ? [cli] : []
  if (process.platform === "win32" || String(prompt).length > 8000) {
    const promptPath = writePromptFile("tura-pi-prompt-", prompt)
    return [...prefix, "--mode", "json", "--print", "--model", normalizedModel, "--thinking", thinking, `@${promptPath}`, "Complete the task exactly as described in the attached prompt file."]
  }
  return [...prefix, "--mode", "json", "--print", "--model", normalizedModel, "--thinking", thinking, prompt]
}

export function opencodeArgs(prompt, options = {}) {
  const model = options.model || process.env.COMMAND_RUN_AGENT_OPENCODE_MODEL || process.env.COMMAND_RUN_AGENT_CODEX_MODEL || "gpt-5.5"
  const normalizedModel = model.includes("/") ? model : `openai/${model}`
  const variant = options.reasoning || process.env.COMMAND_RUN_AGENT_REASONING_EFFORT || "medium"
  const args = ["run", "--format", "json", "--model", normalizedModel, "--variant", variant, "--auto"]
  if (String(prompt).length > 8000) {
    return [...args, "--file", writePromptFile("tura-opencode-prompt-", prompt), "Complete the task exactly as described in the attached prompt file."]
  }
  return [...args, prompt]
}

export function agentUsageFromJsonl(text) {
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }
  for (const event of parseJsonl(text)) {
    for (const value of [event.usage, event.message?.usage, event.result?.usage, event.assistantMessageEvent?.usage].filter(Boolean)) {
      usage.input += Number(value.input_tokens || value.prompt_tokens || 0)
      usage.cached += Number(value.cached_input_tokens || value.cache_read_input_tokens || value.input_tokens_details?.cached_tokens || 0)
      usage.output += Number(value.output_tokens || value.completion_tokens || 0)
      usage.reasoning += Number(value.reasoning_output_tokens || value.reasoning_tokens || value.output_tokens_details?.reasoning_tokens || 0)
      usage.total += Number(value.total_tokens || 0)
    }
  }
  return usage
}

export function agentEventStats(text) {
  const events = parseJsonl(text)
  return {
    events: events.length,
    turns: events.filter((event) => /turn[_-]start|turn\.started/i.test(String(event.type || ""))).length,
    tool_starts: events.filter((event) => /tool[_-]execution[_-]start/i.test(String(event.type || ""))).length,
    tool_ends: events.filter((event) => /tool[_-]execution[_-]end/i.test(String(event.type || ""))).length,
    errors: events.filter((event) => event.isError || /error/i.test(String(event.type || ""))).length,
  }
}

function defaultPiCli() {
  if (process.platform !== "win32") return ""
  return path.join(agentHome(), "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")
}

function defaultOpencodeExe() {
  if (process.platform !== "win32") return ""
  return path.join(agentHome(), "AppData", "Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
}

function writePromptFile(prefix, prompt) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const file = path.join(directory, "prompt.md")
  fs.writeFileSync(file, prompt, "utf8")
  return file
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
