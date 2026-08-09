Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `search_files`: Search Drive for candidate materials. [official-mcp]
- `download_file_content`: Download the headshot with the official single-file Drive MCP tool. [official-mcp]
- `photoshop_crop_image`: Crop an image to exact dimensions and export the result. [vendor-api-adapter]
- `create_file`: Create a Google Docs document with supplied text. [official-mcp]
- `create_event`: Create a Google Calendar event with attendees. [official-mcp]
- `create_draft`: Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
