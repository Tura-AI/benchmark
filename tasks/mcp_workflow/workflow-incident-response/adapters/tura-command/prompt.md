Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `get_issue_details`: Read a Sentry issue with the official issue-details tool. [official-mcp]
- `issue_write`: Create a GitHub issue in a repository. [official-mcp]
- `send_message`: Post an incident update to Slack. [official-mcp]
- `create_draft`: Create a Gmail draft for the incident stakeholder notification through Gmail. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
