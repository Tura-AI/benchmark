Create and distribute the promo card for calendar event `evt-ai-lab-005`.

Read the event details. Generate a Canva `instagram_post` candidate with title `AI Builders Lab` and date text `September 18, 18:00`, materialize candidate `canva-candidate-005`, then export it to `exports/ai-builders-canva.png`. Open that export URL in Photoshop, resize it to 1080x1080, and export `exports/ai-builders-social.png`. Email `attendees-ai-lab@example.com` with subject `AI Builders Lab promo card`, body `The social promo card for September 18 is available at the link below.`. Include the generated artifact URL in the draft body.

Execute all steps with the provided MCP services.

Gmail's official MCP exposes draft creation, not direct sending. Create the required draft and do not claim that Gmail sent it.
Gmail MCP currently documents draft attachments as unsupported. Do not pass `attachments`; put each exact generated artifact URL in the draft body instead.
Use this exact Gmail draft body: `The social promo card for September 18 is available at the link below.

Artifact links:
https://artifacts.mock.invalid/ai-builders-social.png`.
Materialize the generated Canva candidate with job ID `canva-job-005` and candidate ID `canva-candidate-005` before exporting it.
