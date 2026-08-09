Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `search_threads`: Search Gmail messages using Gmail query syntax. [official-mcp]
- `get_thread`: Read one Gmail message and its structured billing request. [official-mcp]
- `create_invoice`: Create a draft Stripe invoice for the customer. [official-mcp]
- `create_invoice_item`: Add the requested seat charge as an item on the draft Stripe invoice. [official-mcp]
- `finalize_invoice`: Finalize a draft Stripe invoice and produce a payment URL. [official-mcp]
- `create_draft`: Create a Gmail reply draft to an existing Gmail message in the same thread. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
