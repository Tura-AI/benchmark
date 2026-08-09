Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `get_event`: Read a Google Calendar event by ID. [official-mcp]
- `generate-design`: Generate Canva design candidates from the requested brief. [official-mcp]
- `create-design-from-candidate`: Create an editable Canva design from the selected generated candidate. [official-mcp]
- `export-design`: Export a Canva design to an artifact. [official-mcp]
- `photoshop_open_document`: Open the Canva export in Photoshop. [vendor-api-adapter]
- `photoshop_resize_image`: Resize a Photoshop image to exact pixel dimensions. [vendor-api-adapter]
- `photoshop_export_image`: Export the resized Photoshop image. [vendor-api-adapter]
- `create_draft`: Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
