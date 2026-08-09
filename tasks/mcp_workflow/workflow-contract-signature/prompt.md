Prepare contract `contract-orion-008` for signature.

Find and download the Drive contract. Open it in Acrobat, add a required signature field named `client_signature` on page 8 at x=72, y=110, width=220, height=48, then export the prepared PDF to `exports/orion-contract-signature.pdf`. Email `legal@orion.example` with subject `Orion contract ready for signature`, body `Please open the prepared contract from the link below and sign it.`, attaching the PDF. Create a Calendar follow-up titled `Follow up: Orion contract signature` at `2026-09-25T09:00:00+02:00` with attendee `legal@orion.example`.

Make the changes using the MCP services.

Use the exact official Google Drive query syntax: `title contains 'contract-orion-008'`.
Gmail's official MCP exposes draft creation, not direct sending. Create the required draft and do not claim that Gmail sent it.
Gmail MCP currently documents draft attachments as unsupported. Do not pass `attachments`; put each exact generated artifact URL in the draft body instead.
Use this exact Gmail draft body: `Please open the prepared contract from the link below and sign it.

Artifact links:
https://artifacts.mock.invalid/orion-contract-signature.pdf`.
