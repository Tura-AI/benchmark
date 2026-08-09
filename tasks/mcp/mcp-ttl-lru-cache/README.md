# Implement a bounded TTL/LRU cache

Finish the in-memory cache with expiration, LRU eviction, statistics, and injectable time.

- Prompt: `prompt.md`
- MCP server and exposed schemas: `mcp_server.py`
- Independent behavioral test: `verify.py`
- Schema-aware run/report entry point: `runner.mjs`
- Starting repository: `fixture/`

The runner records the actual stdio MCP handshake and calls in `mcp/trace.jsonl`, then emits `task-report.json`, `harness-report.json`, `cli-metadata.json`, and `result.json`.
