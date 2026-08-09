Produce the customer review cut of the Nova product demo.

Search Drive for `nova-demo-raw`. Create a Premiere project named `Nova Demo Review`, import the returned raw footage, trim the clip from 12 to 72 seconds, add the caption `Meet Nova: work at the speed of thought`, and export an H.264 1080p MP4 to `exports/nova-demo-review.mp4`. Email `product@example.com` with subject `Nova demo review cut`, body `The 60-second review cut is available at the link below.`. Include the generated artifact URL in the draft body.

Use the MCP tools to perform every operation and produce the actual mock service state.

Use the exact official Google Drive query syntax: `title contains 'nova-demo-raw'`.
Gmail's official MCP exposes draft creation, not direct sending. Create the required draft and do not claim that Gmail sent it.
Gmail MCP currently documents draft attachments as unsupported. Do not pass `attachments`; put each exact generated artifact URL in the draft body instead.
Use this exact Gmail draft body: `The 60-second review cut is available at the link below.

Artifact links:
https://artifacts.mock.invalid/nova-demo-review.mp4`.
