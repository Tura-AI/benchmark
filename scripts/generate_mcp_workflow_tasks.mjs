#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workflowContract } from "../lib/mcp_workflow_contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const taskRoot = path.join(root, "tasks", "mcp_workflow");
const serverSource = path.join(
  root,
  "tools",
  "mock-workflow-mcp-server",
  "server.py",
);
const verifierSource = path.join(
  root,
  "tools",
  "mock-workflow-mcp-server",
  "verify.py",
);

const s = (intent, description, args, result, effects = {}) => {
  const contract = workflowContract(intent, args, result);
  effects = normalizeMessagingEffects(intent, effects);
  const append = { ...(effects.append ?? {}) };
  if (effects.set?.["gmail.lastDraft"] && !append["gmail.drafts"]) {
    append["gmail.drafts"] = effects.set["gmail.lastDraft"];
  }
  if (effects.set?.["gmail.lastReplyDraft"] && !append["gmail.replyDrafts"]) {
    append["gmail.replyDrafts"] = effects.set["gmail.lastReplyDraft"];
  }
  return {
    intent,
    tool: contract.tool,
    description:
      contract.tool === "create_draft"
        ? args.attachments?.length
          ? "Create a Gmail draft that references the generated artifacts by URL; Gmail MCP draft attachments are currently unsupported."
          : description
              .replace(/^Send\b/i, "Create a Gmail draft for")
              .replace(/^Reply\b/i, "Create a Gmail reply draft")
        : contract.tool === "send_message" && args.attachments?.length
          ? "Post a Slack message containing generated artifact URLs."
          : description,
    expectedArguments: contract.expectedArguments,
    argumentAssertions: argumentAssertionsFor(
      intent,
      args,
      contract.expectedArguments,
    ),
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    responseMode: contract.responseMode,
    annotations: contract.annotations,
    contract: {
      provider: contract.provider,
      fidelity: contract.fidelity,
      source: contract.source,
      revision: contract.revision,
      transport: contract.transport,
      authentication: contract.authentication,
      responseMode: contract.responseMode,
    },
    argumentNormalization: normalizationFromSchema(contract.inputSchema),
    result: contract.expectedResult,
    effects: Object.keys(append).length > 0 ? { ...effects, append } : effects,
  };
};

function argumentAssertionsFor(intent, sourceArguments, expectedArguments) {
  const assertion = (path, operator = "normalized-equals", values) => ({
    path,
    operator,
    ...(values ? { values } : {}),
  });
  if (intent === "docs_create_document") {
    return [assertion("title"), assertion("textContent")];
  }
  if (intent === "drive_upload_file") {
    return [assertion("title"), assertion("parentId")];
  }
  if (intent === "calendar_create_event") {
    return [
      assertion("summary"),
      assertion("startTime", "instant-equals"),
      ...(sourceArguments.end ? [assertion("endTime", "instant-equals")] : []),
      assertion("attendees", "set-equals"),
    ];
  }
  if (intent === "canva_create_design") {
    return [
      assertion("design_type"),
      assertion("query", "contains-all", [
        sourceArguments.title,
        sourceArguments.date_text,
      ]),
    ];
  }
  return Object.keys(expectedArguments).map((path) => assertion(path));
}

const WORKFLOW_DEPENDENCIES = {
  "workflow-campaign-image-email": [[], [1], [2], [3], [4], [5], [6]],
  "workflow-contract-signature": [[], [1], [2], [3], [4], [5], []],
  "workflow-customer-onboarding": [[], [1], [2], [1], [3, 4]],
  "workflow-ecommerce-ad-package": [
    [],
    [1],
    [2],
    [3],
    [3],
    [4, 5],
    [1],
    [7],
    [6, 8],
  ],
  "workflow-event-promo-kit": [[], [1], [2], [3], [4], [5], [6], [7]],
  "workflow-incident-response": [[], [1], [2], [2, 3]],
  "workflow-invoice-email-followup": [[], [1], [2], [3], [4], [5]],
  "workflow-product-demo-video": [[], [1], [2], [3], [4], [5], [6]],
  "workflow-recruiting-interview-pack": [
    [],
    [1],
    [1],
    [3],
    [2],
    [2],
    [4, 5, 6],
  ],
  "workflow-social-thumbnail-approval": [[], [1], [2], [3], [4], [5]],
};

const CASE_INSENSITIVE_ENUM_FIELDS = new Set([
  "anchor",
  "codec",
  "currency",
  "format",
  "position",
  "resolution",
]);

const workflows = [
  {
    id: "workflow-campaign-image-email",
    title: "Create a campaign image and send it through Gmail",
    summary:
      "Retrieve a launch brief and source photo, edit the image in Photoshop, export it, and send the finished asset through Gmail.",
    services: ["Google Drive", "Adobe Photoshop", "Gmail"],
    prompt: `Prepare the Spring Launch campaign image and deliver it to marketing.

Find the Drive files matching \`spring-launch-brief\`, read the brief, and use its source image. In Photoshop remove the image background, add the exact text \`Spring Launch - 25% Off\` at \`bottom-center\`, and export a PNG to \`exports/spring-launch.png\`. Send it from Gmail to \`marketing@example.com\` with subject \`Spring Launch creative ready\`, body \`The approved Spring Launch creative is attached.\`, and the exported PNG attached.

Complete the work through the available MCP tools. Do not merely describe the steps.`,
    initialState: {
      drive: { account: "marketing-drive", files: ["brief-001", "image-001"] },
      gmail: { account: "campaigns@example.com", sent: [] },
      photoshop: { documents: {} },
    },
    steps: [
      s(
        "drive_search_files",
        "Search the mock Google Drive for campaign assets.",
        { query: "spring-launch-brief" },
        {
          files: [
            { id: "brief-001", name: "spring-launch-brief.md" },
            { id: "image-001", name: "spring-product-source.psd" },
          ],
        },
      ),
      s(
        "drive_download_file",
        "Download one Drive file and return its mock contents.",
        { file_id: "brief-001" },
        {
          file_id: "brief-001",
          content:
            "Use image-001. Remove background. Add: Spring Launch - 25% Off.",
        },
      ),
      s(
        "photoshop_open_document",
        "Open a Drive asset as a Photoshop document.",
        { asset_uri: "drive://image-001" },
        { document_id: "psdoc-001", width: 2400, height: 1600 },
      ),
      s(
        "photoshop_remove_background",
        "Remove the background from the active Photoshop document.",
        { document_id: "psdoc-001" },
        { document_id: "psdoc-001", background_removed: true },
      ),
      s(
        "photoshop_add_text_layer",
        "Add a positioned text layer to a Photoshop document.",
        {
          document_id: "psdoc-001",
          text: "Spring Launch - 25% Off",
          position: "bottom-center",
        },
        { document_id: "psdoc-001", layer_id: "text-001" },
      ),
      s(
        "photoshop_export_image",
        "Export a Photoshop document as an image artifact.",
        {
          document_id: "psdoc-001",
          output_path: "exports/spring-launch.png",
          format: "png",
        },
        { artifact_path: "exports/spring-launch.png", mime_type: "image/png" },
        {
          set: {
            "artifacts.springLaunchImage": {
              path: "exports/spring-launch.png",
              kind: "image/png",
              backgroundRemoved: true,
              text: "Spring Launch - 25% Off",
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send a Gmail message with optional generated artifacts attached.",
        {
          to: ["marketing@example.com"],
          subject: "Spring Launch creative ready",
          body: "The approved Spring Launch creative is attached.",
          attachments: ["exports/spring-launch.png"],
        },
        { message_id: "gmail-msg-001", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              id: "gmail-msg-001",
              to: ["marketing@example.com"],
              subject: "Spring Launch creative ready",
              attachments: ["exports/spring-launch.png"],
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.springLaunchImage": {
        path: "exports/spring-launch.png",
        backgroundRemoved: true,
        text: "Spring Launch - 25% Off",
      },
      "gmail.lastSent": {
        to: ["marketing@example.com"],
        subject: "Spring Launch creative ready",
        attachments: ["exports/spring-launch.png"],
        status: "sent",
      },
    },
  },
  {
    id: "workflow-product-demo-video",
    title: "Edit a product demo video and email the review copy",
    summary:
      "Find raw footage, build and edit a Premiere sequence, export the review cut, and deliver it with Gmail.",
    services: ["Google Drive", "Adobe Premiere Pro", "Gmail"],
    prompt: `Produce the customer review cut of the Nova product demo.

Search Drive for \`nova-demo-raw\`. Create a Premiere project named \`Nova Demo Review\`, import the returned raw footage, trim the clip from 12 to 72 seconds, add the caption \`Meet Nova: work at the speed of thought\`, and export an H.264 1080p MP4 to \`exports/nova-demo-review.mp4\`. Email \`product@example.com\` with subject \`Nova demo review cut\`, body \`The 60-second review cut is attached.\`, and attach the exported video.

Use the MCP tools to perform every operation and produce the actual mock service state.`,
    initialState: {
      drive: { files: ["video-raw-001"] },
      premiere: { projects: {} },
      gmail: { sent: [] },
    },
    steps: [
      s(
        "drive_search_files",
        "Search Google Drive for media assets.",
        { query: "nova-demo-raw" },
        {
          files: [
            {
              id: "video-raw-001",
              name: "nova-demo-take3.mov",
              duration_seconds: 94,
            },
          ],
        },
      ),
      s(
        "premiere_create_project",
        "Create a mock Adobe Premiere Pro editing project.",
        { name: "Nova Demo Review" },
        { project_id: "premiere-project-001" },
      ),
      s(
        "premiere_import_media",
        "Import a Drive video into a Premiere project.",
        {
          project_id: "premiere-project-001",
          asset_uri: "drive://video-raw-001",
        },
        { clip_id: "clip-001", duration_seconds: 94 },
      ),
      s(
        "premiere_trim_clip",
        "Trim a Premiere clip to exact time boundaries.",
        {
          project_id: "premiere-project-001",
          clip_id: "clip-001",
          start_seconds: 12,
          end_seconds: 72,
        },
        { clip_id: "clip-001", duration_seconds: 60 },
      ),
      s(
        "premiere_add_caption",
        "Add a caption overlay to a Premiere sequence.",
        {
          project_id: "premiere-project-001",
          text: "Meet Nova: work at the speed of thought",
        },
        { caption_id: "caption-001" },
      ),
      s(
        "premiere_export_video",
        "Export a Premiere project to a video artifact.",
        {
          project_id: "premiere-project-001",
          output_path: "exports/nova-demo-review.mp4",
          codec: "h264",
          resolution: "1080p",
        },
        { artifact_path: "exports/nova-demo-review.mp4", duration_seconds: 60 },
        {
          set: {
            "artifacts.reviewVideo": {
              path: "exports/nova-demo-review.mp4",
              codec: "h264",
              resolution: "1080p",
              durationSeconds: 60,
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send a Gmail message with a generated video attachment.",
        {
          to: ["product@example.com"],
          subject: "Nova demo review cut",
          body: "The 60-second review cut is attached.",
          attachments: ["exports/nova-demo-review.mp4"],
        },
        { message_id: "gmail-msg-002", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              to: ["product@example.com"],
              subject: "Nova demo review cut",
              attachments: ["exports/nova-demo-review.mp4"],
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.reviewVideo": {
        path: "exports/nova-demo-review.mp4",
        durationSeconds: 60,
      },
      "gmail.lastSent": {
        to: ["product@example.com"],
        subject: "Nova demo review cut",
        attachments: ["exports/nova-demo-review.mp4"],
        status: "sent",
      },
    },
  },
  {
    id: "workflow-social-thumbnail-approval",
    title: "Polish a Figma thumbnail in Photoshop and request Slack approval",
    summary:
      "Export a Figma frame, enhance it in Photoshop, and post the final thumbnail to the correct Slack channel.",
    services: ["Figma", "Adobe Photoshop", "Slack"],
    prompt: `Prepare the checkout announcement thumbnail for approval.

Open Figma file \`figma-checkout-v2\`, inspect frame \`hero-social\`, and export that frame to \`exports/checkout-hero-source.png\` at 2x PNG. Open the export in Photoshop, apply brightness 8 and contrast 12, then export \`exports/checkout-hero-final.png\` as PNG. Post to Slack channel \`C-MARKETING\` with the exact text \`Checkout v2 social thumbnail ready for approval\` and attach the final image.

Do the work through MCP tools; a prose response alone does not complete the task.`,
    initialState: {
      figma: { files: ["figma-checkout-v2"] },
      photoshop: {},
      slack: { messages: [] },
    },
    steps: [
      s(
        "figma_get_file",
        "Read Figma file metadata and available frames.",
        { file_key: "figma-checkout-v2" },
        {
          name: "Checkout v2",
          frames: [{ id: "hero-social", width: 1200, height: 630 }],
        },
      ),
      s(
        "figma_export_frame",
        "Export a Figma frame as a raster artifact.",
        {
          file_key: "figma-checkout-v2",
          frame_id: "hero-social",
          format: "png",
          scale: 2,
          output_path: "exports/checkout-hero-source.png",
        },
        { artifact_path: "exports/checkout-hero-source.png" },
      ),
      s(
        "photoshop_open_document",
        "Open an exported design in Photoshop.",
        { asset_uri: "https://mock.invalid/checkout-hero-source.png" },
        { document_id: "psdoc-003" },
      ),
      s(
        "photoshop_apply_adjustment",
        "Apply numeric brightness and contrast adjustments.",
        { document_id: "psdoc-003", brightness: 8, contrast: 12 },
        { document_id: "psdoc-003", adjusted: true },
      ),
      s(
        "photoshop_export_image",
        "Export the adjusted Photoshop image.",
        {
          document_id: "psdoc-003",
          output_path: "exports/checkout-hero-final.png",
          format: "png",
        },
        { artifact_path: "exports/checkout-hero-final.png" },
        {
          set: {
            "artifacts.finalThumbnail": {
              path: "exports/checkout-hero-final.png",
              brightness: 8,
              contrast: 12,
            },
          },
        },
      ),
      s(
        "slack_post_message",
        "Post a Slack message with generated artifact attachments.",
        {
          channel_id: "C-MARKETING",
          text: "Checkout v2 social thumbnail ready for approval",
          attachments: ["exports/checkout-hero-final.png"],
        },
        { message_id: "slack-msg-003", status: "posted" },
        {
          set: {
            "slack.lastMessage": {
              channelId: "C-MARKETING",
              text: "Checkout v2 social thumbnail ready for approval",
              attachments: ["exports/checkout-hero-final.png"],
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.finalThumbnail": {
        path: "exports/checkout-hero-final.png",
        brightness: 8,
        contrast: 12,
      },
      "slack.lastMessage": {
        channelId: "C-MARKETING",
        attachments: ["exports/checkout-hero-final.png"],
      },
    },
  },
  {
    id: "workflow-invoice-email-followup",
    title: "Turn a billing email into a finalized Stripe invoice",
    summary:
      "Read a customer billing request in Gmail, create and finalize the matching Stripe invoice, and reply with its URL.",
    services: ["Gmail", "Stripe"],
    prompt: `Process Acme's unread billing request end to end.

Search Gmail for \`from:billing@acme.example is:unread subject:August seats\`, read the returned message, create a Stripe invoice for customer \`cus_acme_001\` in USD with description \`August platform seats\`, quantity 25, unit amount 1200 cents, then finalize it. Reply to the original Gmail message with body \`Your finalized August invoice is available at https://pay.example/inv_acme_aug.\`.

Use the MCP tools and make the external mock state changes; do not only draft an answer.`,
    initialState: {
      gmail: { inbox: [{ id: "gmail-in-004", unread: true }], replies: [] },
      stripe: { customers: ["cus_acme_001"], invoices: [] },
    },
    steps: [
      s(
        "gmail_search_messages",
        "Search Gmail messages using Gmail query syntax.",
        { query: "from:billing@acme.example is:unread subject:August seats" },
        {
          messages: [
            {
              id: "gmail-in-004",
              from: "billing@acme.example",
              subject: "August seats",
            },
          ],
        },
      ),
      s(
        "gmail_read_message",
        "Read one Gmail message and its structured billing request.",
        { message_id: "gmail-in-004" },
        {
          body: "Please invoice cus_acme_001 for 25 August platform seats at $12 each.",
          customer_id: "cus_acme_001",
        },
      ),
      s(
        "stripe_create_invoice",
        "Create a draft Stripe invoice for the customer.",
        {
          customer_id: "cus_acme_001",
        },
        { invoice_id: "inv_acme_aug", status: "draft", amount_due: 0 },
      ),
      s(
        "stripe_create_invoice_item",
        "Add the requested seat charge as an item on the draft Stripe invoice.",
        {
          customer_id: "cus_acme_001",
          invoice_id: "inv_acme_aug",
          amount: 30000,
          currency: "usd",
          description: "August platform seats",
        },
        {
          invoice_item_id: "ii_acme_aug_seats",
          invoice_id: "inv_acme_aug",
        },
      ),
      s(
        "stripe_finalize_invoice",
        "Finalize a draft Stripe invoice and produce a payment URL.",
        { invoice_id: "inv_acme_aug" },
        {
          invoice_id: "inv_acme_aug",
          status: "open",
          hosted_invoice_url: "https://pay.example/inv_acme_aug",
        },
        {
          set: {
            "stripe.finalInvoice": {
              id: "inv_acme_aug",
              customerId: "cus_acme_001",
              amountDue: 30000,
              status: "open",
              url: "https://pay.example/inv_acme_aug",
            },
          },
        },
      ),
      s(
        "gmail_reply_email",
        "Reply to an existing Gmail message in the same thread.",
        {
          message_id: "gmail-in-004",
          body: "Your finalized August invoice is available at https://pay.example/inv_acme_aug.",
        },
        { message_id: "gmail-reply-004", status: "sent" },
        {
          set: {
            "gmail.lastReply": {
              inReplyTo: "gmail-in-004",
              body: "Your finalized August invoice is available at https://pay.example/inv_acme_aug.",
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "stripe.finalInvoice": {
        id: "inv_acme_aug",
        amountDue: 30000,
        status: "open",
      },
      "gmail.lastReply": { inReplyTo: "gmail-in-004", status: "sent" },
    },
  },
  {
    id: "workflow-event-promo-kit",
    title: "Build an event promo card and email the attendee list",
    summary:
      "Read a Calendar event, create its Canva card, resize it in Photoshop, and send it to attendees through Gmail.",
    services: ["Google Calendar", "Canva", "Adobe Photoshop", "Gmail"],
    prompt: `Create and distribute the promo card for calendar event \`evt-ai-lab-005\`.

Read the event details. Generate a Canva \`instagram_post\` candidate with title \`AI Builders Lab\` and date text \`September 18, 18:00\`, materialize candidate \`canva-candidate-005\`, then export it to \`exports/ai-builders-canva.png\`. Open that export URL in Photoshop, resize it to 1080x1080, and export \`exports/ai-builders-social.png\`. Email \`attendees-ai-lab@example.com\` with subject \`AI Builders Lab promo card\`, body \`The social promo card for September 18 is attached.\`, and attach the final image.

Execute all steps with the provided MCP services.`,
    initialState: {
      calendar: { events: ["evt-ai-lab-005"] },
      canva: {},
      photoshop: {},
      gmail: {},
    },
    steps: [
      s(
        "calendar_get_event",
        "Read a Google Calendar event by ID.",
        { event_id: "evt-ai-lab-005" },
        {
          title: "AI Builders Lab",
          starts_at: "2026-09-18T18:00:00+02:00",
          attendee_list: "attendees-ai-lab@example.com",
        },
      ),
      s(
        "canva_create_design",
        "Generate Canva design candidates from the requested brief.",
        {
          template_id: "instagram_post",
          title: "AI Builders Lab",
          date_text: "September 18, 18:00",
        },
        { job_id: "canva-job-005", candidate_id: "canva-candidate-005" },
      ),
      s(
        "canva_materialize_design",
        "Create an editable Canva design from the selected generated candidate.",
        {
          job_id: "canva-job-005",
          candidate_id: "canva-candidate-005",
          title: "AI Builders Lab",
        },
        { design_id: "canva-design-005" },
      ),
      s(
        "canva_export_design",
        "Export a Canva design to an artifact.",
        {
          design_id: "canva-design-005",
          format: "png",
          output_path: "exports/ai-builders-canva.png",
        },
        {
          job_id: "canva-export-job-005",
          artifact_path: "exports/ai-builders-canva.png",
        },
      ),
      s(
        "photoshop_open_document",
        "Open the Canva export in Photoshop.",
        {
          asset_uri: "https://export-download.canva.mock/ai-builders-canva.png",
        },
        { document_id: "psdoc-005" },
      ),
      s(
        "photoshop_resize_image",
        "Resize a Photoshop image to exact pixel dimensions.",
        { document_id: "psdoc-005", width: 1080, height: 1080 },
        { document_id: "psdoc-005", width: 1080, height: 1080 },
      ),
      s(
        "photoshop_export_image",
        "Export the resized Photoshop image.",
        {
          document_id: "psdoc-005",
          output_path: "exports/ai-builders-social.png",
          format: "png",
        },
        { artifact_path: "exports/ai-builders-social.png" },
        {
          set: {
            "artifacts.eventPromo": {
              path: "exports/ai-builders-social.png",
              width: 1080,
              height: 1080,
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send the completed event artwork through Gmail.",
        {
          to: ["attendees-ai-lab@example.com"],
          subject: "AI Builders Lab promo card",
          body: "The social promo card for September 18 is attached.",
          attachments: ["exports/ai-builders-social.png"],
        },
        { message_id: "gmail-msg-005", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              to: ["attendees-ai-lab@example.com"],
              subject: "AI Builders Lab promo card",
              attachments: ["exports/ai-builders-social.png"],
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.eventPromo": {
        path: "exports/ai-builders-social.png",
        width: 1080,
        height: 1080,
      },
      "gmail.lastSent": {
        to: ["attendees-ai-lab@example.com"],
        attachments: ["exports/ai-builders-social.png"],
        status: "sent",
      },
    },
  },
  {
    id: "workflow-recruiting-interview-pack",
    title: "Assemble and send a recruiting interview pack",
    summary:
      "Retrieve candidate files, crop the headshot, create an interview brief, schedule the panel, and email the full pack.",
    services: [
      "Google Drive",
      "Adobe Photoshop",
      "Google Docs",
      "Google Calendar",
      "Gmail",
    ],
    prompt: `Prepare candidate Maya Chen's interview package.

Search Drive for \`Maya Chen staff engineer\` and download the returned resume and headshot together. Crop the headshot to a centered 600x600 square and export it as \`exports/maya-chen-headshot.png\`. Create a Google Doc titled \`Maya Chen - Staff Engineer Interview Brief\` with content \`Focus: distributed systems, mentoring, and incident leadership.\`. Schedule a Calendar event titled \`Maya Chen panel interview\` from \`2026-09-22T14:00:00+02:00\` to \`2026-09-22T15:00:00+02:00\` with attendee \`panel@example.com\`. Finally email \`panel@example.com\` with subject \`Maya Chen interview pack\`, body \`The candidate brief and processed headshot are attached; the panel event is scheduled.\`, attaching \`docs://doc-maya-006\` and the exported headshot.

Perform the workflow through MCP calls.`,
    initialState: {
      drive: { files: ["resume-006", "headshot-006"] },
      docs: {},
      calendar: {},
      gmail: {},
    },
    steps: [
      s(
        "drive_search_files",
        "Search Drive for candidate materials.",
        { query: "Maya Chen staff engineer" },
        {
          files: [
            { id: "resume-006", name: "maya-chen-resume.pdf" },
            { id: "headshot-006", name: "maya-chen-photo.jpg" },
          ],
        },
      ),
      s(
        "drive_download_files",
        "Download the resume with the official single-file Drive MCP tool.",
        { file_ids: ["resume-006"] },
        { assets: ["drive://resume-006"] },
      ),
      s(
        "drive_download_files",
        "Download the headshot with the official single-file Drive MCP tool.",
        { file_ids: ["headshot-006"] },
        { assets: ["drive://headshot-006"] },
      ),
      s(
        "photoshop_crop_image",
        "Crop an image to exact dimensions and export the result.",
        {
          asset_uri: "drive://headshot-006",
          width: 600,
          height: 600,
          anchor: "center",
          output_path: "exports/maya-chen-headshot.png",
        },
        { artifact_path: "exports/maya-chen-headshot.png" },
        {
          set: {
            "artifacts.headshot": {
              path: "exports/maya-chen-headshot.png",
              width: 600,
              height: 600,
              anchor: "center",
            },
          },
        },
      ),
      s(
        "docs_create_document",
        "Create a Google Docs document with supplied text.",
        {
          title: "Maya Chen - Staff Engineer Interview Brief",
          content:
            "Focus: distributed systems, mentoring, and incident leadership.",
        },
        { document_id: "doc-maya-006", uri: "docs://doc-maya-006" },
        {
          set: {
            "docs.interviewBrief": {
              id: "doc-maya-006",
              title: "Maya Chen - Staff Engineer Interview Brief",
            },
          },
        },
      ),
      s(
        "calendar_create_event",
        "Create a Google Calendar event with attendees.",
        {
          title: "Maya Chen panel interview",
          start: "2026-09-22T14:00:00+02:00",
          end: "2026-09-22T15:00:00+02:00",
          attendees: ["panel@example.com"],
        },
        { event_id: "calendar-event-006", status: "confirmed" },
        {
          set: {
            "calendar.lastEvent": {
              id: "calendar-event-006",
              title: "Maya Chen panel interview",
              attendees: ["panel@example.com"],
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send the interview package through Gmail.",
        {
          to: ["panel@example.com"],
          subject: "Maya Chen interview pack",
          body: "The candidate brief and processed headshot are attached; the panel event is scheduled.",
          attachments: [
            "docs://doc-maya-006",
            "exports/maya-chen-headshot.png",
          ],
        },
        { message_id: "gmail-msg-006", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              to: ["panel@example.com"],
              subject: "Maya Chen interview pack",
              attachments: [
                "docs://doc-maya-006",
                "exports/maya-chen-headshot.png",
              ],
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.headshot": { width: 600, height: 600, anchor: "center" },
      "docs.interviewBrief": { id: "doc-maya-006" },
      "calendar.lastEvent": { attendees: ["panel@example.com"] },
      "gmail.lastSent": {
        attachments: ["docs://doc-maya-006", "exports/maya-chen-headshot.png"],
        status: "sent",
      },
    },
  },
  {
    id: "workflow-incident-response",
    title: "Escalate a production incident across GitHub, Slack, and Gmail",
    summary:
      "Inspect a Sentry incident, create its GitHub issue, notify the response channel, and send the stakeholder email.",
    services: ["Sentry", "GitHub", "Slack", "Gmail"],
    prompt: `Escalate Sentry issue \`SENTRY-PAY-500\` in Sentry organization \`acme\`.

Read the Sentry issue using organization \`acme\`, create a GitHub issue in \`tura/payments\` titled \`[P1] Checkout 500 errors\` with body \`Sentry SENTRY-PAY-500 reports 37 checkout failures after deploy 8f21c.\` and labels \`incident\` and \`P1\`. Post in Slack channel \`C-INCIDENTS\`: \`P1 checkout incident tracked at https://github.example/tura/payments/issues/418\`. Email \`stakeholders@example.com\` with subject \`P1 checkout incident opened\` and body \`We opened issue #418 for SENTRY-PAY-500 and notified the incident channel.\`.

Use MCP tools to create all external records.`,
    initialState: {
      sentry: { issues: ["SENTRY-PAY-500"] },
      github: {},
      slack: {},
      gmail: {},
    },
    steps: [
      s(
        "sentry_get_issue",
        "Read a Sentry issue with the official issue-details tool.",
        { organization_slug: "acme", issue_id: "SENTRY-PAY-500" },
        {
          title: "Checkout 500 errors",
          event_count: 37,
          deploy: "8f21c",
          severity: "fatal",
        },
      ),
      s(
        "github_create_issue",
        "Create a GitHub issue in a repository.",
        {
          repository: "tura/payments",
          title: "[P1] Checkout 500 errors",
          body: "Sentry SENTRY-PAY-500 reports 37 checkout failures after deploy 8f21c.",
          labels: ["incident", "P1"],
        },
        { number: 418, url: "https://github.example/tura/payments/issues/418" },
        {
          set: {
            "github.lastIssue": {
              repository: "tura/payments",
              number: 418,
              labels: ["incident", "P1"],
            },
          },
        },
      ),
      s(
        "slack_post_message",
        "Post an incident update to Slack.",
        {
          channel_id: "C-INCIDENTS",
          text: "P1 checkout incident tracked at https://github.example/tura/payments/issues/418",
          attachments: [],
        },
        { message_id: "slack-msg-007", status: "posted" },
        {
          set: {
            "slack.lastMessage": {
              channelId: "C-INCIDENTS",
              text: "P1 checkout incident tracked at https://github.example/tura/payments/issues/418",
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send the incident stakeholder notification through Gmail.",
        {
          to: ["stakeholders@example.com"],
          subject: "P1 checkout incident opened",
          body: "We opened issue #418 for SENTRY-PAY-500 and notified the incident channel.",
          attachments: [],
        },
        { message_id: "gmail-msg-007", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              to: ["stakeholders@example.com"],
              subject: "P1 checkout incident opened",
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "github.lastIssue": {
        repository: "tura/payments",
        number: 418,
        labels: ["incident", "P1"],
      },
      "slack.lastMessage": { channelId: "C-INCIDENTS" },
      "gmail.lastSent": { to: ["stakeholders@example.com"], status: "sent" },
    },
  },
  {
    id: "workflow-contract-signature",
    title: "Prepare a contract signature packet and schedule follow-up",
    summary:
      "Retrieve a contract, add an Acrobat signature field, export it, email the signer, and schedule the reminder event.",
    services: ["Google Drive", "Adobe Acrobat", "Gmail", "Google Calendar"],
    prompt: `Prepare contract \`contract-orion-008\` for signature.

Find and download the Drive contract. Open it in Acrobat, add a required signature field named \`client_signature\` on page 8 at x=72, y=110, width=220, height=48, then export the prepared PDF to \`exports/orion-contract-signature.pdf\`. Email \`legal@orion.example\` with subject \`Orion contract ready for signature\`, body \`Please sign the attached prepared contract.\`, attaching the PDF. Create a Calendar follow-up titled \`Follow up: Orion contract signature\` at \`2026-09-25T09:00:00+02:00\` with attendee \`legal@orion.example\`.

Make the changes using the MCP services.`,
    initialState: {
      drive: { files: ["contract-orion-008"] },
      acrobat: {},
      gmail: {},
      calendar: {},
    },
    steps: [
      s(
        "drive_search_files",
        "Find a contract in Google Drive.",
        { query: "contract-orion-008" },
        {
          files: [
            { id: "contract-orion-008", name: "Orion-MSA-final.pdf", pages: 8 },
          ],
        },
      ),
      s(
        "drive_download_file",
        "Download the selected Drive contract.",
        { file_id: "contract-orion-008" },
        { asset_uri: "drive://contract-orion-008", pages: 8 },
      ),
      s(
        "acrobat_open_document",
        "Open a PDF in Adobe Acrobat.",
        { asset_uri: "drive://contract-orion-008" },
        { document_id: "acrobat-doc-008", pages: 8 },
      ),
      s(
        "acrobat_add_signature_field",
        "Add a required signature field to a PDF page.",
        {
          document_id: "acrobat-doc-008",
          field_name: "client_signature",
          page: 8,
          x: 72,
          y: 110,
          width: 220,
          height: 48,
          required: true,
        },
        { field_id: "signature-field-008" },
      ),
      s(
        "acrobat_export_pdf",
        "Export the prepared Acrobat PDF.",
        {
          document_id: "acrobat-doc-008",
          output_path: "exports/orion-contract-signature.pdf",
        },
        { artifact_path: "exports/orion-contract-signature.pdf" },
        {
          set: {
            "artifacts.preparedContract": {
              path: "exports/orion-contract-signature.pdf",
              signatureField: "client_signature",
              page: 8,
              required: true,
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send the prepared contract to the signer.",
        {
          to: ["legal@orion.example"],
          subject: "Orion contract ready for signature",
          body: "Please sign the attached prepared contract.",
          attachments: ["exports/orion-contract-signature.pdf"],
        },
        { message_id: "gmail-msg-008", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              to: ["legal@orion.example"],
              attachments: ["exports/orion-contract-signature.pdf"],
              status: "sent",
            },
          },
        },
      ),
      s(
        "calendar_create_event",
        "Create a signature follow-up Calendar event.",
        {
          title: "Follow up: Orion contract signature",
          start: "2026-09-25T09:00:00+02:00",
          attendees: ["legal@orion.example"],
        },
        { event_id: "calendar-event-008", status: "confirmed" },
        {
          set: {
            "calendar.lastEvent": {
              title: "Follow up: Orion contract signature",
              start: "2026-09-25T09:00:00+02:00",
              attendees: ["legal@orion.example"],
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.preparedContract": {
        signatureField: "client_signature",
        page: 8,
        required: true,
      },
      "gmail.lastSent": {
        attachments: ["exports/orion-contract-signature.pdf"],
        status: "sent",
      },
      "calendar.lastEvent": { attendees: ["legal@orion.example"] },
    },
  },
  {
    id: "workflow-ecommerce-ad-package",
    title: "Produce an ecommerce video ad package for Slack review",
    summary:
      "Combine Drive media in Premiere, export the ad cut, create its Photoshop thumbnail, and post both outputs to Slack.",
    services: [
      "Google Drive",
      "Adobe Premiere Pro",
      "Adobe Photoshop",
      "Slack",
    ],
    prompt: `Build the Aurora headphones ad review package.

Search Drive for \`aurora-headphones-ad-assets\`. Create Premiere project \`Aurora 15s Ad\`, import video \`drive://aurora-video-009\` and audio \`drive://aurora-music-009\`, trim the video from 4 to 19 seconds, add the audio at -8 dB, and export H.264 1080p to \`exports/aurora-ad-15s.mp4\`. In Photoshop create a 1280x720 thumbnail from \`drive://aurora-still-009\` with text \`Hear Every Detail\`, exporting \`exports/aurora-ad-thumbnail.png\`. Post both artifacts to Slack channel \`C-PAID-SOCIAL\` with text \`Aurora 15-second ad package ready for review\`.

Execute the complete workflow through MCP.`,
    initialState: {
      drive: {
        files: ["aurora-video-009", "aurora-music-009", "aurora-still-009"],
      },
      premiere: {},
      photoshop: {},
      slack: {},
    },
    steps: [
      s(
        "drive_search_files",
        "Find all media assets for an ecommerce ad.",
        { query: "aurora-headphones-ad-assets" },
        {
          files: [
            { id: "aurora-video-009", type: "video" },
            { id: "aurora-music-009", type: "audio" },
            { id: "aurora-still-009", type: "image" },
          ],
        },
      ),
      s(
        "premiere_create_project",
        "Create the Premiere ad project.",
        { name: "Aurora 15s Ad" },
        { project_id: "premiere-project-009" },
      ),
      s(
        "premiere_import_media_batch",
        "Import multiple media assets into Premiere.",
        {
          project_id: "premiere-project-009",
          asset_uris: ["drive://aurora-video-009", "drive://aurora-music-009"],
        },
        { video_clip_id: "clip-video-009", audio_clip_id: "clip-audio-009" },
      ),
      s(
        "premiere_trim_clip",
        "Trim the ad video to a precise duration.",
        {
          project_id: "premiere-project-009",
          clip_id: "clip-video-009",
          start_seconds: 4,
          end_seconds: 19,
        },
        { clip_id: "clip-video-009", duration_seconds: 15 },
      ),
      s(
        "premiere_add_audio",
        "Add an audio clip to a Premiere sequence at a specified gain.",
        {
          project_id: "premiere-project-009",
          audio_clip_id: "clip-audio-009",
          gain_db: -8,
        },
        { audio_clip_id: "clip-audio-009", gain_db: -8 },
      ),
      s(
        "premiere_export_video",
        "Export the finished ad video.",
        {
          project_id: "premiere-project-009",
          output_path: "exports/aurora-ad-15s.mp4",
          codec: "h264",
          resolution: "1080p",
        },
        { artifact_path: "exports/aurora-ad-15s.mp4", duration_seconds: 15 },
        {
          set: {
            "artifacts.adVideo": {
              path: "exports/aurora-ad-15s.mp4",
              durationSeconds: 15,
              gainDb: -8,
            },
          },
        },
      ),
      s(
        "photoshop_create_thumbnail",
        "Create a sized thumbnail with a text layer from a source image.",
        {
          asset_uri: "drive://aurora-still-009",
          width: 1280,
          height: 720,
          text: "Hear Every Detail",
        },
        { document_id: "psdoc-009" },
      ),
      s(
        "photoshop_export_image",
        "Export the ad thumbnail from Photoshop.",
        {
          document_id: "psdoc-009",
          output_path: "exports/aurora-ad-thumbnail.png",
          format: "png",
        },
        { artifact_path: "exports/aurora-ad-thumbnail.png" },
        {
          set: {
            "artifacts.thumbnail": {
              path: "exports/aurora-ad-thumbnail.png",
              width: 1280,
              height: 720,
              text: "Hear Every Detail",
            },
          },
        },
      ),
      s(
        "slack_post_message",
        "Post both review artifacts to Slack.",
        {
          channel_id: "C-PAID-SOCIAL",
          text: "Aurora 15-second ad package ready for review",
          attachments: [
            "exports/aurora-ad-15s.mp4",
            "exports/aurora-ad-thumbnail.png",
          ],
        },
        { message_id: "slack-msg-009", status: "posted" },
        {
          set: {
            "slack.lastMessage": {
              channelId: "C-PAID-SOCIAL",
              attachments: [
                "exports/aurora-ad-15s.mp4",
                "exports/aurora-ad-thumbnail.png",
              ],
            },
          },
        },
      ),
    ],
    expectedState: {
      "artifacts.adVideo": {
        path: "exports/aurora-ad-15s.mp4",
        durationSeconds: 15,
        gainDb: -8,
      },
      "artifacts.thumbnail": {
        width: 1280,
        height: 720,
        text: "Hear Every Detail",
      },
      "slack.lastMessage": {
        channelId: "C-PAID-SOCIAL",
        attachments: [
          "exports/aurora-ad-15s.mp4",
          "exports/aurora-ad-thumbnail.png",
        ],
      },
    },
  },
  {
    id: "workflow-customer-onboarding",
    title: "Create and send a customer onboarding package",
    summary:
      "Read the CRM record, create and upload the onboarding plan, schedule kickoff, and send the customer welcome email.",
    services: [
      "HubSpot",
      "Google Docs",
      "Google Drive",
      "Google Calendar",
      "Gmail",
    ],
    prompt: `Onboard the new Lumon account from HubSpot company \`hubspot-company-010\`.

Read the company record. Create a Google Doc titled \`Lumon 30-Day Onboarding Plan\` with content \`Week 1: access and data import. Week 2: workflow setup. Week 3: team training. Week 4: launch review.\`. Upload that document to Drive folder \`drive-folder-onboarding\` as \`Lumon-30-Day-Onboarding-Plan\`. Schedule \`Lumon kickoff\` from \`2026-09-28T16:00:00+02:00\` to \`2026-09-28T16:45:00+02:00\` with attendees \`admin@lumon.example\` and \`csm@example.com\`. Email \`admin@lumon.example\` with subject \`Welcome to Tura - Lumon kickoff\`, body \`Your onboarding plan is attached and the kickoff invitation has been created.\`, attaching \`drive://drive-file-010\`.

Use MCP calls to create the document, file, event, and email.`,
    initialState: {
      hubspot: { companies: ["hubspot-company-010"] },
      docs: {},
      drive: {},
      calendar: {},
      gmail: {},
    },
    steps: [
      s(
        "hubspot_get_company",
        "Read a HubSpot company record and onboarding contacts.",
        { company_id: "hubspot-company-010" },
        {
          name: "Lumon",
          domain: "lumon.example",
          primary_contact: "admin@lumon.example",
          lifecycle_stage: "customer",
        },
      ),
      s(
        "docs_create_document",
        "Create the customer onboarding plan in Google Docs.",
        {
          title: "Lumon 30-Day Onboarding Plan",
          content:
            "Week 1: access and data import. Week 2: workflow setup. Week 3: team training. Week 4: launch review.",
        },
        { document_id: "doc-onboarding-010", uri: "docs://doc-onboarding-010" },
        {
          set: {
            "docs.onboardingPlan": {
              id: "doc-onboarding-010",
              title: "Lumon 30-Day Onboarding Plan",
            },
          },
        },
      ),
      s(
        "drive_upload_file",
        "Upload a document URI into a Google Drive folder.",
        {
          source_uri: "docs://doc-onboarding-010",
          folder_id: "drive-folder-onboarding",
          name: "Lumon-30-Day-Onboarding-Plan",
        },
        { file_id: "drive-file-010", uri: "drive://drive-file-010" },
        {
          set: {
            "drive.uploadedPlan": {
              id: "drive-file-010",
              folderId: "drive-folder-onboarding",
              name: "Lumon-30-Day-Onboarding-Plan",
            },
          },
        },
      ),
      s(
        "calendar_create_event",
        "Schedule the customer kickoff in Google Calendar.",
        {
          title: "Lumon kickoff",
          start: "2026-09-28T16:00:00+02:00",
          end: "2026-09-28T16:45:00+02:00",
          attendees: ["admin@lumon.example", "csm@example.com"],
        },
        { event_id: "calendar-event-010", status: "confirmed" },
        {
          set: {
            "calendar.lastEvent": {
              title: "Lumon kickoff",
              attendees: ["admin@lumon.example", "csm@example.com"],
            },
          },
        },
      ),
      s(
        "gmail_send_email",
        "Send the customer welcome email with the Drive plan attached.",
        {
          to: ["admin@lumon.example"],
          subject: "Welcome to Tura - Lumon kickoff",
          body: "Your onboarding plan is attached and the kickoff invitation has been created.",
          attachments: ["drive://drive-file-010"],
        },
        { message_id: "gmail-msg-010", status: "sent" },
        {
          set: {
            "gmail.lastSent": {
              to: ["admin@lumon.example"],
              subject: "Welcome to Tura - Lumon kickoff",
              attachments: ["drive://drive-file-010"],
              status: "sent",
            },
          },
        },
      ),
    ],
    expectedState: {
      "docs.onboardingPlan": { id: "doc-onboarding-010" },
      "drive.uploadedPlan": {
        id: "drive-file-010",
        folderId: "drive-folder-onboarding",
      },
      "calendar.lastEvent": {
        attendees: ["admin@lumon.example", "csm@example.com"],
      },
      "gmail.lastSent": {
        to: ["admin@lumon.example"],
        attachments: ["drive://drive-file-010"],
        status: "sent",
      },
    },
  },
];

assert.equal(workflows.length, 10);
assert.equal(new Set(workflows.map((item) => item.id)).size, 10);
fs.mkdirSync(taskRoot, { recursive: true });
for (const workflow of workflows) generate(workflow);
process.stdout.write(`generated ${workflows.length} MCP workflow tasks\n`);

function generate(workflow) {
  const directory = path.join(taskRoot, workflow.id);
  fs.mkdirSync(path.join(directory, "fixture"), { recursive: true });
  fs.mkdirSync(path.join(directory, "adapters", "codex"), { recursive: true });
  fs.mkdirSync(path.join(directory, "adapters", "tura-command"), {
    recursive: true,
  });
  const dependencies = WORKFLOW_DEPENDENCIES[workflow.id];
  assert.equal(dependencies?.length, workflow.steps.length);
  const steps = workflow.steps.map((step, index) => {
    const stepNumber = index + 1;
    assert.ok(
      dependencies[index].every(
        (required) => Number.isInteger(required) && required < stepNumber,
      ),
      `${workflow.id} step ${stepNumber} has an invalid dependency`,
    );
    return {
      ...step,
      stepId: `step-${String(stepNumber).padStart(2, "0")}`,
      requires: dependencies[index].map(
        (required) => `step-${String(required).padStart(2, "0")}`,
      ),
    };
  });
  const expectedState = normalizeEmailState(workflow.expectedState);
  for (const step of steps) {
    for (const target of ["gmail.drafts", "gmail.replyDrafts"]) {
      if (step.effects.append?.[target]) {
        expectedState[target] = [step.effects.append[target]];
      }
    }
  }
  const scenario = {
    schema: "tura.benchmark.mcp-workflow-scenario.v2",
    id: workflow.id,
    serverName: `tura_mock_${workflow.id.replaceAll("-", "_")}`,
    services: workflow.services,
    evaluation: {
      mode: "deterministic-script",
      llmJudge: false,
      humanReview: false,
      checks: [
        "critical-argument-assertions",
        "dependency-order",
        "recovered-tool-errors-allowed",
        "exact-final-state",
      ],
    },
    initialState: normalizeEmailState(workflow.initialState),
    steps,
    expectedState,
    selfTest: {
      calls: steps.map((step) => ({
        name: step.tool,
        arguments: step.expectedArguments,
      })),
    },
  };
  const harness = makeHarness(workflow, steps);
  const task = makeTask(workflow, scenario, harness);
  writeJson(path.join(directory, "scenario.json"), scenario);
  writeJson(path.join(directory, "harness.json"), harness);
  writeJson(path.join(directory, "task.json"), task);
  writeJson(
    path.join(directory, "benchmark.task.json"),
    makeDeclaration(workflow),
  );
  fs.writeFileSync(
    path.join(directory, "prompt.md"),
    `${normalizePrompt(workflow.prompt)}${workflowProtocolHints(steps)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(directory, "runner.mjs"),
    `#!/usr/bin/env node\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\nimport { runMcpTask } from "../../../lib/mcp_task_runner.mjs";\n\nawait runMcpTask(path.dirname(fileURLToPath(import.meta.url)));\n`,
    "utf8",
  );
  fs.copyFileSync(serverSource, path.join(directory, "mcp_server.py"));
  fs.copyFileSync(verifierSource, path.join(directory, "verify.py"));
  fs.writeFileSync(
    path.join(directory, "fixture", "README.md"),
    `# ${workflow.title}\n\nThis workspace intentionally contains no vendor state. Gmail, Adobe, Drive, and other service data lives in the run-scoped mock MCP state and is only accessible through MCP tools.\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(directory, "README.md"),
    `# ${workflow.id}\n\n${workflow.summary}\n\nMock services: ${workflow.services.join(", ")}. Official MCP tools use versioned public vendor contracts; products without an official MCP are explicitly marked as vendor API adapters. The server uses MCP JSON-RPC over stdio while keeping all external side effects deterministic and local to one benchmark attempt.\n`,
    "utf8",
  );
  generateAdapters(directory, workflow, scenario, steps);
}

function makeHarness(workflow, steps) {
  const location = (symbol) => ({
    repository: "Tura-AI/benchmark",
    path:
      symbol === "verify_workflow"
        ? `tasks/mcp_workflow/${workflow.id}/verify.py`
        : "lib/mcp_task_runner.mjs",
    symbol,
  });
  const sourceLocation = {
    repository: "Tura-AI/benchmark",
    path: `tasks/mcp_workflow/${workflow.id}/scenario.json`,
  };
  const item = (suffix, name, description, category, symbol) => ({
    id: `${workflow.id}-${suffix}`,
    name,
    description,
    category,
    harnessCodeLocation: location(symbol),
    sourceLocation,
  });
  return {
    schema: "tura.benchmark.task-harness.v1",
    id: `${workflow.id}-harness`,
    codeLocation: {
      repository: "Tura-AI/benchmark",
      path: `tasks/mcp_workflow/${workflow.id}/runner.mjs`,
      symbol: "runMcpTask",
    },
    scoreItemCount: 5,
    scoreItems: [
      item(
        "mcp-initialize",
        "MCP initialization",
        "The agent completed the MCP initialize handshake.",
        "mcp-protocol",
        "evaluateChecks",
      ),
      item(
        "mcp-tools-list",
        "Tool schema discovery",
        `The agent discovered all ${steps.length} workflow tool schemas through tools/list.`,
        "mcp-schema",
        "evaluateChecks",
      ),
      item(
        "required-tools",
        "Required service operations",
        "Every required vendor-aligned MCP operation completed successfully.",
        "mcp-workflow",
        "evaluateChecks",
      ),
      item(
        "tool-order",
        "Cross-service dependency order",
        "The required operations respected the workflow dependency graph; recoverable failed attempts do not invalidate a completed workflow.",
        "mcp-workflow",
        "evaluateChecks",
      ),
      item(
        "task-behavior",
        "Final remote state",
        "The independent verifier confirmed all generated artifacts and external service mutations.",
        "task-correctness",
        "verify_workflow",
      ),
    ],
  };
}

function makeTask(workflow, scenario, harness) {
  return {
    schema: "tura.benchmark.task.v1",
    id: workflow.id,
    category: "mcp",
    title: workflow.title,
    description: workflow.summary,
    source: {
      language: "MCP JSON-RPC and deterministic mock service state",
      repository: "https://github.com/Tura-AI/benchmark",
      commit: null,
      codePath: `tasks/mcp_workflow/${workflow.id}/fixture`,
    },
    target: {
      language: "Stateful multi-service MCP workflow",
      deliverable:
        "Verified run-scoped service state produced exclusively through the task-local MCP server.",
    },
    taskDeclaration: {
      repository: "Tura-AI/benchmark",
      path: `tasks/mcp_workflow/${workflow.id}/benchmark.task.json`,
    },
    harness,
    contracts: {
      round: "tura.benchmark.agent-round.v1",
      taskReport: "tura.benchmark.task-report.v1",
      harnessReport: "tura.benchmark.harness-report.v2",
    },
    mcp: {
      server: scenario.serverName,
      transport: "stdio",
      entrypoint: `tasks/mcp_workflow/${workflow.id}/mcp_server.py`,
      schemaDiscovery: "tools/list",
      traceArtifact: "mcp/trace.jsonl",
      stateArtifact: "mcp/state.json",
      scenario: `tasks/mcp_workflow/${workflow.id}/scenario.json`,
      mode: "stateful-workflow",
      services: workflow.services,
      adapters: {
        manifest: `tasks/mcp_workflow/${workflow.id}/adapters/manifest.json`,
        codex: `tasks/mcp_workflow/${workflow.id}/adapters/codex/config.toml`,
        turaCommand: `tasks/mcp_workflow/${workflow.id}/adapters/tura-command/command.toml`,
      },
    },
    methodology: {
      style: "Multi-step vendor-aligned mock MCP workflow",
      deterministicExternalState: true,
      realMcpTransport: true,
      externalSideEffects: false,
      scoring: "deterministic-script-only",
      llmJudge: false,
      humanReview: false,
    },
  };
}

function makeDeclaration(workflow) {
  return {
    schema: "tura.benchmark.task-declaration.v1",
    id: workflow.id,
    type: "mcp",
    title: workflow.title,
    directory: `tasks/mcp_workflow/${workflow.id}`,
    summary: workflow.summary,
    contract: {
      cliMetadata: "tura.benchmark.cli-metadata.v1",
      round: "tura.benchmark.agent-round.v1",
      taskReport: "tura.benchmark.task-report.v1",
      harnessReport: "tura.benchmark.harness-report.v2",
    },
    variants: [
      {
        id: "codex-stdio",
        label: "Codex or Tura with a stateful mock workflow MCP",
        runner: "runner.mjs",
        default: true,
      },
    ],
    duplicatePolicy: "none",
  };
}

function generateAdapters(directory, workflow, scenario, steps) {
  const server = {
    name: scenario.serverName,
    transport: "stdio",
    command: "${python}",
    args: [
      "${taskDir}/mcp_server.py",
      "--workspace",
      "${workspace}",
      "--trace",
      "${tracePath}",
      "--scenario",
      "${scenarioPath}",
      "--state",
      "${statePath}",
    ],
    schemaDiscovery: "tools/list",
    tools: [...new Set(steps.map((step) => step.tool))],
    contracts: [
      ...new Map(steps.map((step) => [step.tool, step.contract])).entries(),
    ].map(([tool, contract]) => ({ tool, ...contract })),
  };
  const manifest = {
    schema: "tura.benchmark.mcp-agent-adapters.v1",
    taskId: workflow.id,
    server,
    adapters: {
      codex: {
        format: "codex.mcp-stdio.toml.v1",
        configTemplate: "adapters/codex/config.toml",
        settings: {
          required: true,
          defaultToolsApprovalMode: "approve",
          startupTimeoutSec: 30,
          toolTimeoutSec: 120,
        },
      },
      turaCommand: {
        format: "tura.external-command.v1",
        commandId: "mcp_workspace",
        packageDirectory: "adapters/tura-command",
        bridgeDescriptor: "adapters/tura-command/bridge.json",
        agentCapability: { capability_name: "mcp_workspace" },
      },
    },
  };
  const adapterRoot = path.join(directory, "adapters");
  writeJson(path.join(adapterRoot, "manifest.json"), manifest);
  fs.writeFileSync(
    path.join(adapterRoot, "codex", "config.toml"),
    `[mcp_servers.${server.name}]\ncommand = "\${python}"\nargs = ["\${taskDir}/mcp_server.py", "--workspace", "\${workspace}", "--trace", "\${tracePath}", "--scenario", "\${scenarioPath}", "--state", "\${statePath}"]\nrequired = true\ndefault_tools_approval_mode = "approve"\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n`,
    "utf8",
  );
  const tura = path.join(adapterRoot, "tura-command");
  fs.writeFileSync(
    path.join(tura, "command.toml"),
    `id = "mcp_workspace"\nname = "MCP Workflow"\ndescription = "Call one tool exposed by the task-local stateful workflow MCP server."\ncore = false\ncategory = "mcp"\nexecution = "one_shot"\nstate_machine = "default_command"\nsupports_macro_command = true\nmutating = true\nnetwork = false\n\n[runtime]\nbinary = "tura-command-mcp-stdio-bridge"\nentry = ""\nlanguage = "rust"\n\n[limits]\ndefault_timeout_ms = 120000\nmax_timeout_ms = 300000\n\n[paths]\nprompt = "prompt.md"\nschema = "schema.json"\npolicy = "policy.toml"\n`,
    "utf8",
  );
  writeJson(path.join(tura, "schema.json"), {
    name: "mcp_workspace",
    description:
      "Dispatch one schema-validated tools/call request to the run-scoped mock workflow MCP server.",
    input_schema: {
      oneOf: [...new Map(steps.map((step) => [step.tool, step])).values()].map(
        (step) => ({
          title: step.tool,
          type: "object",
          required: ["name", "arguments"],
          additionalProperties: false,
          properties: {
            name: { const: step.tool, description: step.description },
            arguments: step.inputSchema,
          },
        }),
      ),
    },
  });
  fs.writeFileSync(
    path.join(tura, "prompt.md"),
    `Use \`mcp_workspace\` for every external service operation in this task. Pass native MCP \`tools/call\` parameters as \`{"name": ..., "arguments": ...}\`.\n\nAvailable tools:\n\n${[...new Map(steps.map((step) => [step.tool, step])).values()].map((step) => `- \`${step.tool}\`: ${step.description} [${step.contract.fidelity}]`).join("\n")}\n\nThe services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(tura, "policy.toml"),
    "read_only = false\nnetwork = false\n",
    "utf8",
  );
  writeJson(path.join(tura, "agent-capability.json"), {
    capability_name: "mcp_workspace",
  });
  writeJson(path.join(tura, "bridge.json"), {
    schema: "tura.benchmark.tura-command-mcp-bridge.v1",
    taskId: workflow.id,
    commandId: "mcp_workspace",
    runtimeBinary: "tura-command-mcp-stdio-bridge",
    runtimeSource: "tools/tura-command-mcp-stdio-bridge",
    buildCommand: "npm run mcp:tura-bridge:build",
    connectionLifecycle: {
      scope: "benchmark-attempt",
      broker: "lib/mcp_stdio_broker.mjs",
      lazyInitialize: true,
      authentication: "ephemeral-random-token",
    },
    externalProtocol: {
      invocation: ["${runtimeBinary}", "--protocol"],
      request: {
        kind: "execute",
        argumentsPath: "payload.arguments",
        workspacePath: "payload.session_dir",
        callIdPath: "payload.call_id",
      },
      response: {
        required: ["ok", "success", "output", "stderr", "exit_code"],
      },
    },
    mcpServer: server,
    mapping: {
      "payload.arguments.name": "tools/call.params.name",
      "payload.arguments.arguments": "tools/call.params.arguments",
      "payload.session_dir": "server.args.${workspace}",
    },
    requiredHandshake: [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ],
  });
  fs.writeFileSync(
    path.join(adapterRoot, "README.md"),
    `# Agent adapters for ${workflow.id}\n\nBoth adapters resolve the same run-scoped stdio MCP server. Codex receives a native MCP configuration; Tura receives the same tool schemas through its external-command package and persistent MCP broker.\n`,
    "utf8",
  );
}

function normalizationFromSchema(schema, prefix = "") {
  const rules = {};
  for (const [key, child] of Object.entries(schema.properties || {})) {
    const dottedPath = prefix ? `${prefix}.${key}` : key;
    if (
      child.type === "string" &&
      child.enum &&
      CASE_INSENSITIVE_ENUM_FIELDS.has(key)
    ) {
      rules[dottedPath] = "lowercase";
    } else if (child?.type === "object") {
      Object.assign(rules, normalizationFromSchema(child, dottedPath));
    }
  }
  return rules;
}

function normalizeMessagingEffects(intent, effects) {
  if (intent.startsWith("gmail_")) {
    return normalizeMessagingArtifactFields(
      JSON.parse(
        JSON.stringify(effects)
          .replaceAll("gmail.lastSent", "gmail.lastDraft")
          .replaceAll("gmail.lastReply", "gmail.lastReplyDraft")
          .replaceAll("gmail.sent", "gmail.drafts")
          .replaceAll("gmail.replies", "gmail.replyDrafts")
          .replaceAll('\"status\":\"sent\"', '\"status\":\"draft\"'),
      ),
    );
  }
  if (intent === "slack_post_message") {
    return normalizeMessagingArtifactFields(effects);
  }
  return effects;
}

function normalizeEmailState(value) {
  return normalizeMessagingArtifactFields(
    JSON.parse(
      JSON.stringify(value)
        .replaceAll("lastSent", "lastDraft")
        .replaceAll("lastReply", "lastReplyDraft")
        .replaceAll('\"sent\":', '\"drafts\":')
        .replaceAll('\"replies\":', '\"replyDrafts\":')
        .replaceAll('\"status\":\"sent\"', '\"status\":\"draft\"'),
    ),
  );
}

function artifactShareUrl(value) {
  const driveMatch = /^(?:drive|docs):\/\/(.+)$/.exec(String(value));
  if (driveMatch) {
    return `https://drive.mock.invalid/files/${encodeURIComponent(driveMatch[1])}`;
  }
  const name = String(value).split(/[\\/]/).pop();
  return `https://artifacts.mock.invalid/${encodeURIComponent(name)}`;
}

function normalizeMessagingArtifactFields(value, messagingScope = false) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeMessagingArtifactFields(item, messagingScope),
    );
  }
  if (!value || typeof value !== "object") return value;
  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    const childMessagingScope =
      messagingScope ||
      key === "gmail" ||
      key.startsWith("gmail.") ||
      key === "slack" ||
      key.startsWith("slack.");
    if (childMessagingScope && key === "attachments") {
      normalized.linkedArtifacts = child.map(artifactShareUrl);
    } else {
      normalized[key] = normalizeMessagingArtifactFields(
        child,
        childMessagingScope,
      );
    }
  }
  return normalized;
}

function normalizePrompt(prompt) {
  return prompt
    .replace(
      "Please sign the attached prepared contract.",
      "Please open the prepared contract from the link below and sign it.",
    )
    .replace(/\bare attached\b/gi, "are available at the links below")
    .replace(/\bis attached\b/gi, "is available at the link below")
    .replace(/send it from Gmail/gi, "Create a Gmail draft")
    .replace(/Finally email/gi, "Finally create a Gmail draft to")
    .replace(/Finally, email/gi, "Finally, create a Gmail draft to")
    .replace(
      /reply to (?:the )?message/gi,
      "create a reply draft to the message",
    )
    .replace(
      /send (?:it|the result|the finished asset|the review copy) through Gmail/gi,
      "create a Gmail draft containing it",
    )
    .replace(
      /reply to (?:the )?message/gi,
      "create a reply draft to the message",
    )
    .replace(/Send it to/gi, "Create a Gmail draft to")
    .replace(/Send the /gi, "Create a Gmail draft with the ")
    .replace(/ and email /gi, " and draft an email for ")
    .replace(/\battached\b/gi, "available from the artifact link in the draft")
    .replace(
      /,?\s+and the\s+([^.]+)\s+available from the artifact link in the draft\./gi,
      ". Include the generated $1 URL in the draft body.",
    )
    .replace(
      /,?\s+and attach(?:ing)?\s+the\s+[^.]+\./gi,
      ". Include the generated artifact URL in the draft body.",
    )
    .replace(
      /,?\s+and attach\s+[^.]+\./gi,
      ". Include the generated artifact URL in the draft body.",
    );
}

function workflowProtocolHints(steps) {
  const lines = [];
  const driveQueries = steps
    .filter((step) => step.tool === "search_files")
    .map((step) => step.expectedArguments.query);
  if (driveQueries.length) {
    lines.push(
      `Use the exact official Google Drive query syntax: ${driveQueries.map((query) => `\`${query}\``).join(", ")}.`,
    );
  }
  if (steps.some((step) => step.tool === "create_draft")) {
    lines.push(
      "Gmail's official MCP exposes draft creation, not direct sending. Create the required draft and do not claim that Gmail sent it.",
      "Gmail MCP currently documents draft attachments as unsupported. Do not pass `attachments`; put each exact generated artifact URL in the draft body instead.",
    );
    for (const step of steps.filter((item) => item.tool === "create_draft")) {
      lines.push(
        `Use this exact Gmail draft body: \`${step.expectedArguments.body.replaceAll("`", "\\`")}\`.`,
      );
    }
  }
  for (const step of steps.filter((item) => item.tool === "send_message")) {
    lines.push(
      `Use this exact Slack message value: \`${step.expectedArguments.message.replaceAll("`", "\\`")}\`.`,
    );
  }
  const canvaCandidate = steps.find(
    (step) => step.tool === "create-design-from-candidate",
  );
  if (canvaCandidate) {
    lines.push(
      `Materialize the generated Canva candidate with job ID \`${canvaCandidate.expectedArguments.job_id}\` and candidate ID \`${canvaCandidate.expectedArguments.candidate_id}\` before exporting it.`,
    );
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
