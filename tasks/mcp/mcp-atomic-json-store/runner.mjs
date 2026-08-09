#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMcpTask } from "../../../lib/mcp_task_runner.mjs";

await runMcpTask(path.dirname(fileURLToPath(import.meta.url)));
