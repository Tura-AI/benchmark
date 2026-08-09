Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `hubspot_get_company`: Read a HubSpot company record and onboarding contacts. [vendor-api-adapter]
- `create_file`: Upload a document URI into a Google Drive folder. [official-mcp]
- `create_event`: Schedule the customer kickoff in Google Calendar. [official-mcp]
- `create_draft`: Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
