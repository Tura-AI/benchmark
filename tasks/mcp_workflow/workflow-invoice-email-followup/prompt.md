Process Acme's unread billing request end to end.

Search Gmail for `from:billing@acme.example is:unread subject:August seats`, read the returned message, create a Stripe invoice for customer `cus_acme_001` in USD with description `August platform seats`, quantity 25, unit amount 1200 cents, then finalize it. Reply to the original Gmail message with body `Your finalized August invoice is available at https://pay.example/inv_acme_aug.`.

Use the MCP tools and make the external mock state changes; do not only draft an answer.

Gmail's official MCP exposes draft creation, not direct sending. Create the required draft and do not claim that Gmail sent it.
Gmail MCP currently documents draft attachments as unsupported. Do not pass `attachments`; put each exact generated artifact URL in the draft body instead.
Use this exact Gmail draft body: `Your finalized August invoice is available at https://pay.example/inv_acme_aug.`.
