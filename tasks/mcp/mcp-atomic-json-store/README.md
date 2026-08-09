# Implement an atomic JSON document store

Add crash-safe JSON persistence with optimistic revisions, backups, and transactional updates.

- Prompt: `prompt.md`
- MCP server and exposed schemas: `mcp_server.py`
- Independent behavioral test: `verify.py`
- Schema-aware run/report entry point: `runner.mjs`
- Starting repository: `fixture/`

The runner records the actual stdio MCP handshake and calls in `mcp/trace.jsonl`, then emits `task-report.json`, `harness-report.json`, `cli-metadata.json`, and `result.json`.
