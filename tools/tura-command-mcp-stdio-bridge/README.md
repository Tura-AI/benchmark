# Tura Command MCP stdio bridge

This executable translates Tura's one-shot external-command protocol into one
complete MCP stdio interaction:

```text
Tura execute envelope
  -> initialize
  -> notifications/initialized
  -> tools/list
  -> tools/call
  -> Tura external-command response
```

Build it into the location resolved by Tura's command registry:

```powershell
npm run mcp:tura-bridge:build
```

The benchmark runner supplies these per-run environment variables:

- `TURA_MCP_SERVER_COMMAND`
- `TURA_MCP_SERVER_ARGS_JSON`
- `TURA_MCP_SERVER_NAME`

The Tura command argument must preserve MCP `tools/call` parameters:

```json
{ "name": "read_file", "arguments": { "path": "src/example.py" } }
```
