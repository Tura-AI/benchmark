import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";

export async function startMcpStdioBroker(options) {
  const client = new StdioMcpClient(options);
  let initialization = null;
  let tools = null;
  const initialize = () => {
    initialization ??= (async () => {
      await client.start();
      const listed = await client.request("tools/list", {});
      tools = new Set(
        (listed.tools || []).map((tool) => tool?.name).filter(Boolean),
      );
    })();
    return initialization;
  };
  const token = crypto.randomBytes(32).toString("hex");
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk;
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      const line = input.slice(0, newline);
      input = "";
      void dispatch(line, socket);
    });
  });

  async function dispatch(line, socket) {
    try {
      const request = JSON.parse(line);
      if (!crypto.timingSafeEqual(tokenBytes(request.token), tokenBytes(token)))
        throw new Error("invalid MCP broker token");
      await initialize();
      if (!tools.has(request.name))
        throw new Error(`MCP server does not expose tool ${request.name}`);
      const result = await client.request("tools/call", {
        name: request.name,
        arguments: request.arguments || {},
      });
      if (result?.isError)
        throw new Error(
          result.content?.map((item) => item?.text || "").join("\n") ||
            `MCP tool ${request.name} failed`,
        );
      socket.end(`${JSON.stringify({ ok: true, result })}\n`);
    } catch (error) {
      socket.end(
        `${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`,
      );
    }
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("MCP broker did not bind a TCP address");
  let stopped = false;
  return {
    address: `127.0.0.1:${address.port}`,
    token,
    async stop() {
      if (stopped) return;
      stopped = true;
      await new Promise((resolve) => server.close(resolve));
      await client.stop();
    },
  };
}

export async function callMcpStdioBroker(address, token, name, arguments_) {
  const [host, portText] = String(address).split(":");
  const port = Number(portText);
  if (!host || !Number.isInteger(port))
    throw new Error(`invalid MCP broker address: ${address}`);
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setEncoding("utf8");
    let input = "";
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      input += chunk;
    });
    socket.once("end", () => {
      try {
        const response = JSON.parse(input.trim());
        if (!response.ok)
          throw new Error(response.error || "MCP broker failed");
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({ token, name, arguments: arguments_ })}\n`,
      );
    });
  });
}

class StdioMcpClient {
  constructor(options) {
    this.command = options.command;
    this.args = options.args || [];
    this.timeoutMs = Number(options.timeoutMs || 120_000);
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stdoutBuffer = "";
    this.stderr = "";
  }

  async start() {
    this.child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.once("error", (error) => this.rejectAll(error));
    this.child.once("exit", (code, signal) => {
      this.rejectAll(
        new Error(
          `MCP server exited with ${code ?? signal ?? "unknown status"}: ${this.stderr}`,
        ),
      );
    });
    const initialized = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "tura-benchmark-mcp-broker", version: "1.0.0" },
    });
    if (initialized?.protocolVersion !== PROTOCOL_VERSION)
      throw new Error(
        `MCP protocol negotiation failed: expected ${PROTOCOL_VERSION}, got ${initialized?.protocolVersion}`,
      );
    if (!initialized?.capabilities?.tools)
      throw new Error("MCP server did not advertise the tools capability");
    this.notify("notifications/initialized", {});
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  send(payload) {
    if (!this.child?.stdin?.writable)
      throw new Error("MCP server stdin is not writable");
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        this.rejectAll(
          new Error(`invalid MCP server response: ${error.message}`),
        );
        continue;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error)
        pending.reject(
          new Error(
            `MCP ${pending.method} failed: ${JSON.stringify(response.error)}`,
          ),
        );
      else pending.resolve(response.result);
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async stop() {
    if (!this.child) return;
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 2_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function tokenBytes(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest();
}
