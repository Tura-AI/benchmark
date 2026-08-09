# Agent adapters for mcp-atomic-json-store

- `manifest.json` is the single normalized stdio server definition.
- `codex/config.toml` is the Codex CLI MCP configuration template.
- `tura-command/` is a Tura external-command package. Its command line is the native MCP `tools/call` object: `{"name": ..., "arguments": ...}`.
- The Tura package uses the shared `tools/tura-command-mcp-stdio-bridge` runtime to translate Tura's one-shot external-command envelope into a run-scoped, token-authenticated broker. The broker lazily initializes one stdio MCP server per benchmark attempt and reuses it for every tool call. Build the bridge with `npm run mcp:tura-bridge:build`.

Template variables are resolved per run: `python`, `taskDir`, `workspace`, and `tracePath`.
