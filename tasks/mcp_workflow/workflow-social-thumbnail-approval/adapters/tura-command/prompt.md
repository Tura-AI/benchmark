Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `get_metadata`: Read Figma file metadata and available frames. [official-mcp]
- `download_assets`: Export a Figma frame as a raster artifact. [official-mcp]
- `photoshop_open_document`: Open an exported design in Photoshop. [vendor-api-adapter]
- `photoshop_apply_adjustment`: Apply numeric brightness and contrast adjustments. [vendor-api-adapter]
- `photoshop_export_image`: Export the adjusted Photoshop image. [vendor-api-adapter]
- `send_message`: Post a Slack message containing generated artifact URLs. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
