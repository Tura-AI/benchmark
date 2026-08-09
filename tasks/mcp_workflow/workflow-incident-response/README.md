# workflow-incident-response

Inspect a Sentry incident, create its GitHub issue, notify the response channel, and send the stakeholder email.

Mock services: Sentry, GitHub, Slack, Gmail. Official MCP tools use versioned public vendor contracts; products without an official MCP are explicitly marked as vendor API adapters. The server uses MCP JSON-RPC over stdio while keeping all external side effects deterministic and local to one benchmark attempt.
