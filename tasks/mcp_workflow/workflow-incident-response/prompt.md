Escalate Sentry issue `SENTRY-PAY-500` in Sentry organization `acme`.

Read the Sentry issue using organization `acme`, create a GitHub issue in `tura/payments` titled `[P1] Checkout 500 errors` with body `Sentry SENTRY-PAY-500 reports 37 checkout failures after deploy 8f21c.` and labels `incident` and `P1`. Post in Slack channel `C-INCIDENTS`: `P1 checkout incident tracked at https://github.example/tura/payments/issues/418`. Email `stakeholders@example.com` with subject `P1 checkout incident opened` and body `We opened issue #418 for SENTRY-PAY-500 and notified the incident channel.`.

Use MCP tools to create all external records.

Gmail's official MCP exposes draft creation, not direct sending. Create the required draft and do not claim that Gmail sent it.
Gmail MCP currently documents draft attachments as unsupported. Do not pass `attachments`; put each exact generated artifact URL in the draft body instead.
Use this exact Gmail draft body: `We opened issue #418 for SENTRY-PAY-500 and notified the incident channel.`.
Use this exact Slack message value: `P1 checkout incident tracked at https://github.example/tura/payments/issues/418`.
