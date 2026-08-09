# MCP workflow contract policy

These tasks use real MCP JSON-RPC lifecycle and tool-result envelopes against
deterministic, run-scoped service state. The mock does not contact a live user
account.

Every step records a versioned contract with one of two fidelity values:

- `official-mcp`: the exposed tool name, exercised JSON fields, annotations,
  and behavior constraints are taken from the provider's published MCP
  surface. Current snapshots cover Google Workspace, Figma, Canva, Stripe,
  Slack, and GitHub tools used by this collection. Optional provider fields not
  exercised by a task may still be omitted from the mock snapshot.
- `vendor-api-adapter`: the exact public MCP tool schema or deterministic
  response shape needed by the task is not available. The namespaced tool
  models the documented vendor API and is never presented as an official MCP
  tool. This applies to Photoshop, Premiere Pro, Acrobat, and the structured
  HubSpot CRM lookup in these scenarios. HubSpot publishes a remote MCP server,
  but its public overview does not pin the tool schema used by this benchmark.

The authoritative executable snapshots live in
`lib/mcp_workflow_contracts.mjs`. They are not inferred from example arguments.
Each generated `scenario.json` embeds the selected source URL, revision date,
transport/authentication metadata, input schema, output schema, and MCP tool
annotations.

Behavioral limitations are part of the snapshot. In particular, Google Drive
queries use the documented `title contains` syntax; Gmail operations create
drafts rather than sending mail and do not use attachments while the official
MCP documents them as unsupported; Canva generation materializes a returned
candidate before export; and Stripe invoice workflows use the public
`create_invoice`, `create_invoice_item`, and `finalize_invoice` tools rather
than a generic REST wrapper. Sentry issue inspection uses the official
`get_issue_details` name, camelCase arguments, and its text-only result behavior
without inventing an `outputSchema` or `structuredContent` response.

The task-local server enforces `initialize`, protocol negotiation,
`notifications/initialized`, schema discovery, dependency-safe calls, input and
output validation, and emits both text content and `structuredContent` for tools
that publish structured output. Text-only tools are checked separately. Every
`tools/call` is accepted or rejected at call time: invalid schemas, unavailable
resources, missing workflow prerequisites, and critical semantic mismatches
return an MCP tool result with `isError: true` and a field-level diagnostic.
Rejected calls never mutate service state. A later corrected call may succeed,
matching normal MCP client retry behavior.

The mock is deliberately strict about business identity and side effects but
tolerant about equivalent representations. Unicode/whitespace normalization,
equivalent ISO-8601 instants, unordered recipient sets, provider-optional
fields, and free-text search/design briefs with the required anchor terms are
accepted where the vendor surface permits them. Wrong resource IDs, titles,
recipients, dimensions, amounts, or content remain immediate tool errors.

The independent verifier does not defer service validation until the end. It
replays the recorded successful state transitions, checks the workflow DAG and
contract envelopes, and confirms final state. Failed attempts remain visible in
the MCP trace for diagnostics but do not invalidate a fully corrected workflow.
