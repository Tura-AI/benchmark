Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `search_files`: Search Google Drive for media assets. [official-mcp]
- `premiere_create_project`: Create a mock Adobe Premiere Pro editing project. [vendor-api-adapter]
- `premiere_import_media`: Import a Drive video into a Premiere project. [vendor-api-adapter]
- `premiere_trim_clip`: Trim a Premiere clip to exact time boundaries. [vendor-api-adapter]
- `premiere_add_caption`: Add a caption overlay to a Premiere sequence. [vendor-api-adapter]
- `premiere_export_video`: Export a Premiere project to a video artifact. [vendor-api-adapter]
- `create_draft`: Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
