Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `search_files`: Search the mock Google Drive for campaign assets. [official-mcp]
- `download_file_content`: Download one Drive file and return its mock contents. [official-mcp]
- `photoshop_open_document`: Open a Drive asset as a Photoshop document. [vendor-api-adapter]
- `photoshop_remove_background`: Remove the background from the active Photoshop document. [vendor-api-adapter]
- `photoshop_add_text_layer`: Add a positioned text layer to a Photoshop document. [vendor-api-adapter]
- `photoshop_export_image`: Export a Photoshop document as an image artifact. [vendor-api-adapter]
- `create_draft`: Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
