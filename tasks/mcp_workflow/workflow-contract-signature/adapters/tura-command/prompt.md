Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `search_files`: Find a contract in Google Drive. [official-mcp]
- `download_file_content`: Download the selected Drive contract. [official-mcp]
- `acrobat_open_document`: Open a PDF in Adobe Acrobat. [vendor-api-adapter]
- `acrobat_add_signature_field`: Add a required signature field to a PDF page. [vendor-api-adapter]
- `acrobat_export_pdf`: Export the prepared Acrobat PDF. [vendor-api-adapter]
- `create_draft`: Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported. [official-mcp]
- `create_event`: Create a signature follow-up Calendar event. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
