/**
 * Versioned tool-contract snapshots used by the deterministic MCP workflows.
 *
 * `official-mcp` entries are executable snapshots of a documented vendor MCP
 * tool name, the fields exercised by this benchmark, and its published
 * behavior constraints. `vendor-api-adapter` entries are deliberately
 * namespaced and model a documented vendor API when the exact public MCP tool
 * schema or deterministic response shape required by the task is unavailable.
 * No contract in this file is inferred from a benchmark example.
 */

const str = { type: "string", minLength: 1 };
const assetUri = {
  type: "string",
  minLength: 1,
  pattern: "^(?:(?:drive|artifact)://[^/].*|https://.+)$",
  description:
    "Asset URI. Use drive://<file-id> for benchmark Drive state, artifact://<path> for local generated artifacts, or the exact HTTPS download URL returned by an official MCP export tool.",
};
const num = { type: "number" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const strings = { type: "array", items: str };
const anyObject = { type: "object", additionalProperties: true };

function object(
  properties,
  required = Object.keys(properties),
  additionalProperties = false,
) {
  return { type: "object", properties, required, additionalProperties };
}

const attachment = object(
  { id: str, filename: str, mimeType: str, content: str, inline: bool },
  ["content"],
);
const draft = object(
  {
    id: str,
    subject: str,
    threadId: str,
    toRecipients: strings,
    ccRecipients: strings,
    bccRecipients: strings,
    plaintextBody: str,
    date: str,
    htmlBody: str,
  },
  ["id", "subject", "threadId", "toRecipients", "plaintextBody", "date"],
  true,
);
const driveFile = object(
  {
    id: str,
    title: str,
    parentId: str,
    mimeType: str,
    fileSize: str,
    description: str,
    fileExtension: str,
    contentSnippet: str,
    viewUrl: str,
    sharedWithMeTime: str,
    createdTime: str,
    modifiedTime: str,
    viewedByMeTime: str,
    owner: str,
    canAddChildren: bool,
  },
  ["id", "title", "mimeType"],
  true,
);
const event = object(
  {
    id: str,
    status: str,
    htmlLink: str,
    summary: str,
    start: anyObject,
    end: anyObject,
    attendees: { type: "array", items: anyObject },
  },
  ["id", "status", "summary", "start", "end"],
  true,
);

const SOURCES = {
  gmail: "https://developers.google.com/workspace/gmail/api/reference/mcp",
  drive: "https://developers.google.com/workspace/drive/api/reference/mcp",
  calendar:
    "https://developers.google.com/workspace/calendar/api/v3/reference/mcp",
  figma:
    "https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/",
  canva: "https://www.canva.dev/docs/mcp/tools/",
  stripe: "https://docs.stripe.com/mcp",
  slack: "https://docs.slack.dev/ai/slack-mcp-server/",
  github: "https://github.com/github/github-mcp-server",
  photoshop: "https://developer.adobe.com/photoshop/",
  premiere: "https://developer.adobe.com/premiere-pro/",
  acrobat: "https://developer.adobe.com/document-services/apis/pdf-services/",
  hubspot: "https://developers.hubspot.com/ai-tools/mcp",
  sentry: "https://github.com/getsentry/sentry-mcp",
};

function official(provider, tool, inputSchema, outputSchema, annotations = {}) {
  return {
    provider,
    tool,
    fidelity: "official-mcp",
    source: SOURCES[provider],
    revision: "2026-08-09",
    transport: "streamable-http",
    authentication: "oauth-2.0",
    responseMode: outputSchema === null ? "text-only" : "structured-json",
    inputSchema,
    outputSchema,
    annotations,
  };
}

function adapter(
  provider,
  intent,
  inputSchema,
  outputSchema,
  annotations = {},
) {
  return {
    provider,
    tool: `${provider}_${intent}`,
    fidelity: "vendor-api-adapter",
    source: SOURCES[provider],
    revision: "2026-08-09",
    transport: "stdio-mock",
    authentication: "mock-run-scope",
    responseMode: "structured-json",
    inputSchema,
    outputSchema,
    annotations,
  };
}

const C = {
  drive_search_files: official(
    "drive",
    "search_files",
    object(
      {
        query: {
          ...str,
          description:
            "Google Drive MCP query syntax, for example: title contains 'brief'",
        },
        pageToken: str,
        pageSize: { ...int, minimum: 1 },
        excludeContentSnippets: bool,
      },
      [],
    ),
    object(
      { files: { type: "array", items: driveFile }, nextPageToken: str },
      ["files"],
      true,
    ),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  drive_download_file: official(
    "drive",
    "download_file_content",
    object({ fileId: str, exportMimeType: str }, ["fileId"]),
    object({ id: str, title: str, mimeType: str, content: str }, [
      "id",
      "title",
      "mimeType",
      "content",
    ]),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  drive_download_files: official(
    "drive",
    "download_file_content",
    object({ fileId: str, exportMimeType: str }, ["fileId"]),
    object({ id: str, title: str, mimeType: str, content: str }, [
      "id",
      "title",
      "mimeType",
      "content",
    ]),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  drive_upload_file: official(
    "drive",
    "create_file",
    object(
      {
        title: str,
        mimeType: str,
        contentMimeType: str,
        content: str,
        base64Content: str,
        textContent: str,
        parentId: str,
        disableConversionToGoogleType: bool,
      },
      ["title"],
    ),
    driveFile,
    { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  ),
  docs_create_document: official(
    "drive",
    "create_file",
    object(
      {
        title: str,
        mimeType: str,
        contentMimeType: str,
        content: str,
        base64Content: str,
        textContent: str,
        parentId: str,
        disableConversionToGoogleType: bool,
      },
      ["title"],
    ),
    driveFile,
    { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  ),
  gmail_search_messages: official(
    "gmail",
    "search_threads",
    object(
      {
        pageSize: { ...int, minimum: 1, maximum: 50 },
        pageToken: str,
        query: str,
        includeTrash: bool,
        view: {
          type: "string",
          enum: [
            "THREAD_VIEW_UNSPECIFIED",
            "THREAD_VIEW_METADATA_ONLY",
            "THREAD_VIEW_MINIMAL",
          ],
        },
      },
      [],
    ),
    object(
      {
        threads: { type: "array", items: anyObject },
        nextPageToken: str,
        resultCountEstimate: str,
      },
      ["threads", "resultCountEstimate"],
      true,
    ),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  gmail_read_message: official(
    "gmail",
    "get_thread",
    object(
      {
        threadId: str,
        messageFormat: {
          type: "string",
          enum: [
            "MESSAGE_FORMAT_UNSPECIFIED",
            "MINIMAL",
            "FULL_CONTENT",
            "METADATA_ONLY",
          ],
        },
      },
      ["threadId"],
    ),
    object({ id: str, messages: { type: "array", items: anyObject } }, [
      "id",
      "messages",
    ]),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  gmail_send_email: official(
    "gmail",
    "create_draft",
    object(
      {
        to: strings,
        cc: strings,
        bcc: strings,
        subject: { type: "string" },
        body: { type: "string" },
        htmlBody: { type: "string" },
        replyToMessageId: str,
        attachments: {
          type: "array",
          items: attachment,
          description:
            "Published in the tool schema, but Gmail MCP currently documents draft attachments as unsupported.",
        },
      },
      [],
    ),
    draft,
    { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  ),
  gmail_reply_email: official(
    "gmail",
    "create_draft",
    object(
      {
        to: strings,
        cc: strings,
        bcc: strings,
        subject: { type: "string" },
        body: { type: "string" },
        htmlBody: { type: "string" },
        replyToMessageId: str,
        attachments: {
          type: "array",
          items: attachment,
          description:
            "Published in the tool schema, but Gmail MCP currently documents draft attachments as unsupported.",
        },
      },
      [],
    ),
    draft,
    { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  ),
  calendar_get_event: official(
    "calendar",
    "get_event",
    object({ eventId: str, calendarId: str }, ["eventId"]),
    event,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  calendar_create_event: official(
    "calendar",
    "create_event",
    object(
      {
        summary: str,
        startTime: str,
        endTime: str,
        attendees: {
          type: "array",
          items: object({ email: str }, ["email"], true),
        },
        calendarId: str,
        description: str,
        timeZone: str,
      },
      ["summary", "startTime", "endTime"],
    ),
    event,
    { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  ),
  figma_get_file: official(
    "figma",
    "get_metadata",
    object({ fileKey: str, nodeId: str }, ["fileKey"]),
    object(
      {
        fileKey: str,
        name: str,
        metadata: str,
        nodes: { type: "array", items: anyObject },
      },
      ["fileKey", "name", "metadata"],
      true,
    ),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  ),
  figma_export_frame: official(
    "figma",
    "download_assets",
    object(
      {
        fileKey: str,
        nodeIds: strings,
        defaultFormat: { type: "string", enum: ["PNG", "JPG", "SVG", "PDF"] },
        defaultScale: num,
      },
      ["fileKey", "nodeIds"],
    ),
    object(
      {
        assets: {
          type: "array",
          items: object(
            { nodeId: str, url: str, format: str },
            ["nodeId", "url", "format"],
            true,
          ),
        },
        rawImagesTruncated: bool,
      },
      ["assets"],
      true,
    ),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  ),
  canva_create_design: official(
    "canva",
    "generate-design",
    object({ query: str, design_type: str, asset_ids: strings }, ["query"]),
    object({
      job: object({
        id: str,
        status: { type: "string", enum: ["in_progress", "success", "failed"] },
        result: object({
          generated_designs: {
            type: "array",
            items: object({
              candidate_id: str,
              url: str,
              thumbnails: { type: "array", items: object({ url: str }) },
            }),
          },
        }),
      }),
    }),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  canva_materialize_design: official(
    "canva",
    "create-design-from-candidate",
    object({ job_id: str, candidate_id: str, title: str }, [
      "job_id",
      "candidate_id",
    ]),
    object({
      design_summary: object(
        {
          id: str,
          title: str,
          urls: object({ edit_url: str, view_url: str }, ["edit_url"]),
        },
        ["id", "title", "urls"],
      ),
    }),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  canva_export_design: official(
    "canva",
    "export-design",
    object(
      {
        id: str,
        format: {
          type: "string",
          enum: ["png", "jpg", "pdf", "pptx", "mp4", "gif"],
        },
        quality: str,
        size: num,
        width: int,
        height: int,
        lossless: bool,
      },
      ["id", "format"],
    ),
    object({
      job: object(
        {
          id: str,
          status: {
            type: "string",
            enum: ["in_progress", "success", "failed"],
          },
          urls: strings,
        },
        ["id", "status"],
      ),
    }),
    { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  ),
  slack_post_message: official(
    "slack",
    "send_message",
    object({ channel_id: str, message: str }, ["channel_id", "message"]),
    object(
      { message_timestamp: str, message_link: str },
      ["message_timestamp"],
      true,
    ),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  stripe_create_invoice: official(
    "stripe",
    "create_invoice",
    object({ customer: str, days_until_due: int }, ["customer"]),
    object(
      {
        id: str,
        object: str,
        status: str,
        amount_due: int,
        hosted_invoice_url: str,
      },
      ["id", "object", "status"],
      true,
    ),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  stripe_create_invoice_item: official(
    "stripe",
    "create_invoice_item",
    object(
      {
        customer: str,
        invoice: str,
        amount: int,
        currency: str,
        description: str,
      },
      ["customer", "invoice", "amount", "currency"],
    ),
    object(
      {
        id: str,
        object: str,
        invoice: str,
        amount: int,
        currency: str,
        description: str,
      },
      ["id", "object", "invoice", "amount", "currency"],
      true,
    ),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  stripe_finalize_invoice: official(
    "stripe",
    "finalize_invoice",
    object({ invoice: str }, ["invoice"]),
    object(
      {
        id: str,
        object: str,
        status: str,
        amount_due: int,
        hosted_invoice_url: str,
      },
      ["id", "object", "status"],
      true,
    ),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  github_create_issue: official(
    "github",
    "issue_write",
    object(
      {
        method: { type: "string", enum: ["create"] },
        owner: str,
        repo: str,
        title: str,
        body: str,
        labels: strings,
      },
      ["method", "owner", "repo", "title"],
    ),
    object(
      { number: int, html_url: str, state: str },
      ["number", "html_url", "state"],
      true,
    ),
    { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  ),
  sentry_get_issue: official(
    "sentry",
    "get_issue_details",
    object(
      {
        organizationSlug: {
          ...str,
          description: "The organization's slug.",
        },
        regionUrl: {
          default: null,
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        issueId: {
          ...str,
          description: "The Sentry issue short ID, for example PROJECT-123.",
        },
        eventId: {
          ...str,
          pattern: "^[0-9a-fA-F]{32}$",
        },
        issueUrl: { ...str, format: "uri" },
      },
      [],
    ),
    null,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  ),
};

const vendorSignatures = {
  acrobat_open_document: [
    "acrobat",
    "open_document",
    { asset_uri: assetUri },
    { document_id: str, pages: int },
  ],
  acrobat_add_signature_field: [
    "acrobat",
    "add_signature_field",
    {
      document_id: str,
      field_name: str,
      page: int,
      x: num,
      y: num,
      width: num,
      height: num,
      required: bool,
    },
    { field_id: str },
  ],
  acrobat_export_pdf: [
    "acrobat",
    "export_pdf",
    { document_id: str, output_path: str },
    { artifact_path: str, content: str, share_url: str },
  ],
  photoshop_open_document: [
    "photoshop",
    "open_document",
    { asset_uri: assetUri },
    object({ document_id: str, width: int, height: int }, ["document_id"]),
  ],
  photoshop_remove_background: [
    "photoshop",
    "remove_background",
    { document_id: str },
    { document_id: str, background_removed: bool },
  ],
  photoshop_add_text_layer: [
    "photoshop",
    "add_text_layer",
    { document_id: str, text: str, position: str },
    { document_id: str, layer_id: str },
  ],
  photoshop_export_image: [
    "photoshop",
    "export_image",
    {
      document_id: str,
      output_path: str,
      format: { type: "string", enum: ["png"] },
    },
    object(
      { artifact_path: str, mime_type: str, content: str, share_url: str },
      ["artifact_path", "content", "share_url"],
    ),
  ],
  photoshop_apply_adjustment: [
    "photoshop",
    "apply_adjustment",
    { document_id: str, brightness: num, contrast: num },
    { document_id: str, adjusted: bool },
  ],
  photoshop_resize_image: [
    "photoshop",
    "resize_image",
    { document_id: str, width: int, height: int },
    { document_id: str, width: int, height: int },
  ],
  photoshop_crop_image: [
    "photoshop",
    "crop_image",
    {
      asset_uri: assetUri,
      width: int,
      height: int,
      anchor: str,
      output_path: str,
    },
    { artifact_path: str, content: str, share_url: str },
  ],
  photoshop_create_thumbnail: [
    "photoshop",
    "create_thumbnail",
    { asset_uri: assetUri, width: int, height: int, text: str },
    { document_id: str },
  ],
  premiere_create_project: [
    "premiere",
    "create_project",
    { name: str },
    { project_id: str },
  ],
  premiere_import_media: [
    "premiere",
    "import_media",
    { project_id: str, asset_uri: assetUri },
    { clip_id: str, duration_seconds: num },
  ],
  premiere_import_media_batch: [
    "premiere",
    "import_media_batch",
    { project_id: str, asset_uris: { type: "array", items: assetUri } },
    { video_clip_id: str, audio_clip_id: str },
  ],
  premiere_trim_clip: [
    "premiere",
    "trim_clip",
    { project_id: str, clip_id: str, start_seconds: num, end_seconds: num },
    { clip_id: str, duration_seconds: num },
  ],
  premiere_add_caption: [
    "premiere",
    "add_caption",
    { project_id: str, text: str },
    { caption_id: str },
  ],
  premiere_add_audio: [
    "premiere",
    "add_audio",
    { project_id: str, audio_clip_id: str, gain_db: num },
    { audio_clip_id: str, gain_db: num },
  ],
  premiere_export_video: [
    "premiere",
    "export_video",
    {
      project_id: str,
      output_path: str,
      codec: { type: "string", enum: ["h264"] },
      resolution: { type: "string", enum: ["1080p"] },
    },
    { artifact_path: str, duration_seconds: num, content: str, share_url: str },
  ],
  hubspot_get_company: [
    "hubspot",
    "get_company",
    { company_id: str },
    { name: str, domain: str, primary_contact: str, lifecycle_stage: str },
  ],
};
for (const [key, [provider, intent, input, output]] of Object.entries(
  vendorSignatures,
)) {
  C[key] = adapter(
    provider,
    intent,
    input.type === "object" ? input : object(input),
    output.type === "object" ? output : object(output),
    {
      readOnlyHint: /^(open|get)/.test(intent),
      idempotentHint: /^(open|get)/.test(intent),
      openWorldHint: false,
    },
  );
}

function basename(path) {
  return String(path).split(/[\\/]/).pop();
}

function shareUrlFor(path) {
  const driveMatch = /^(?:drive|docs):\/\/(.+)$/.exec(String(path));
  if (driveMatch) {
    return `https://drive.mock.invalid/files/${encodeURIComponent(driveMatch[1])}`;
  }
  return `https://artifacts.mock.invalid/${encodeURIComponent(basename(path))}`;
}

function draftLinkLanguage(text) {
  return String(text)
    .replace(
      "Please sign the attached prepared contract.",
      "Please open the prepared contract from the link below and sign it.",
    )
    .replace(/\bare attached\b/gi, "are available at the links below")
    .replace(/\bis attached\b/gi, "is available at the link below");
}

function isoEnd(start) {
  const date = new Date(start);
  if (Number.isNaN(date.valueOf())) return start;
  date.setTime(date.getTime() + 30 * 60_000);
  return date.toISOString();
}

function transform(intent, args, result) {
  switch (intent) {
    case "drive_search_files":
      return [
        { query: `title contains '${args.query}'` },
        {
          files: result.files.map((file) => ({
            id: file.id,
            title: file.name || file.title || file.id,
            mimeType: file.mimeType || "application/octet-stream",
          })),
        },
      ];
    case "drive_download_file":
      return [
        { fileId: args.file_id },
        {
          id: result.file_id || args.file_id,
          title: `${result.file_id || args.file_id}.bin`,
          mimeType: "application/octet-stream",
          content: Buffer.from(
            result.content || `mock:${args.file_id}`,
          ).toString("base64"),
        },
      ];
    case "drive_download_files": {
      const id = args.file_ids[0];
      return [
        { fileId: id },
        {
          id,
          title: `${id}.bin`,
          mimeType: "application/octet-stream",
          content: Buffer.from(`mock:${id}`).toString("base64"),
        },
      ];
    }
    case "docs_create_document":
      return [
        {
          title: args.title,
          contentMimeType: "text/plain",
          textContent: args.content,
        },
        {
          id: result.document_id,
          title: args.title,
          mimeType: "application/vnd.google-apps.document",
          viewUrl: `https://drive.mock.invalid/files/${result.document_id}`,
        },
      ];
    case "drive_upload_file":
      return [
        {
          title: args.name,
          parentId: args.folder_id,
          contentMimeType: "text/plain",
          textContent: args.source_uri,
        },
        {
          id: result.file_id,
          title: args.name,
          parentId: args.folder_id,
          mimeType: "application/vnd.google-apps.document",
          viewUrl: `https://drive.mock.invalid/files/${result.file_id}`,
        },
      ];
    case "gmail_search_messages":
      return [
        { query: args.query },
        {
          threads: result.messages.map((message) => ({
            id: message.id,
            messages: [
              {
                id: message.id,
                sender: message.from,
                subject: message.subject,
              },
            ],
          })),
          resultCountEstimate: String(result.messages.length),
        },
      ];
    case "gmail_read_message":
      return [
        { threadId: args.message_id, messageFormat: "FULL_CONTENT" },
        {
          id: args.message_id,
          messages: [
            {
              id: args.message_id,
              plaintextBody: result.body,
              subject: "August seats",
              sender: "billing@acme.example",
              toRecipients: ["billing@example.com"],
              ccRecipients: [],
              date: "2026-08-25",
            },
          ],
        },
      ];
    case "gmail_send_email": {
      const linkedArtifacts = (args.attachments || []).map(shareUrlFor);
      const baseBody = draftLinkLanguage(args.body);
      const body = linkedArtifacts.length
        ? `${baseBody}\n\nArtifact links:\n${linkedArtifacts.join("\n")}`
        : baseBody;
      return [
        { to: args.to, subject: args.subject, body },
        {
          id: result.message_id,
          subject: args.subject,
          threadId: `thread-${result.message_id}`,
          toRecipients: args.to,
          plaintextBody: body,
          date: "2026-08-09",
        },
      ];
    }
    case "gmail_reply_email":
      return [
        { replyToMessageId: args.message_id, body: args.body },
        {
          id: result.message_id,
          subject: "Re: August seats",
          threadId: args.message_id,
          toRecipients: ["billing@acme.example"],
          plaintextBody: args.body,
          date: "2026-08-09",
        },
      ];
    case "calendar_get_event":
      return [
        { eventId: args.event_id },
        {
          id: args.event_id,
          status: "confirmed",
          summary: result.title,
          start: { dateTime: result.starts_at },
          end: { dateTime: isoEnd(result.starts_at) },
          attendees: [{ email: result.attendee_list }],
        },
      ];
    case "calendar_create_event":
      return [
        {
          summary: args.title,
          startTime: args.start,
          endTime: args.end || isoEnd(args.start),
          attendees: (args.attendees || []).map((email) => ({ email })),
        },
        {
          id: result.event_id,
          status: result.status,
          summary: args.title,
          start: { dateTime: args.start },
          end: { dateTime: args.end || isoEnd(args.start) },
          attendees: (args.attendees || []).map((email) => ({ email })),
        },
      ];
    case "figma_get_file":
      return [
        { fileKey: args.file_key },
        {
          fileKey: args.file_key,
          name: result.name,
          metadata: `<frame id="${result.frames[0].id}" width="${result.frames[0].width}" height="${result.frames[0].height}"/>`,
          nodes: result.frames,
        },
      ];
    case "figma_export_frame":
      return [
        {
          fileKey: args.file_key,
          nodeIds: [args.frame_id],
          defaultFormat: args.format.toUpperCase(),
          defaultScale: args.scale,
        },
        {
          assets: [
            {
              nodeId: args.frame_id,
              url: `https://mock.invalid/${basename(args.output_path)}`,
              format: args.format.toUpperCase(),
            },
          ],
          rawImagesTruncated: false,
        },
      ];
    case "canva_create_design":
      return [
        {
          query: `${args.title} - ${args.date_text}`,
          design_type: args.template_id,
        },
        {
          job: {
            id: result.job_id,
            status: "success",
            result: {
              generated_designs: [
                {
                  candidate_id: result.candidate_id,
                  url: `https://www.canva.com/d/${result.candidate_id}`,
                  thumbnails: [
                    { url: `https://design.canva.ai/${result.candidate_id}` },
                  ],
                },
              ],
            },
          },
        },
      ];
    case "canva_materialize_design":
      return [
        {
          job_id: args.job_id,
          candidate_id: args.candidate_id,
          title: args.title,
        },
        {
          design_summary: {
            id: result.design_id,
            title: args.title,
            urls: {
              edit_url: `https://www.canva.com/design/${result.design_id}/edit`,
              view_url: `https://www.canva.com/design/${result.design_id}/view`,
            },
          },
        },
      ];
    case "canva_export_design":
      return [
        { id: args.design_id, format: args.format },
        {
          job: {
            id: result.job_id,
            status: "success",
            urls: [
              `https://export-download.canva.mock/${basename(args.output_path)}`,
            ],
          },
        },
      ];
    case "slack_post_message":
      return [
        {
          channel_id: args.channel_id,
          message: `${args.text}${args.attachments?.length ? `\n\nArtifact links:\n${args.attachments.map(shareUrlFor).join("\n")}` : ""}`,
        },
        {
          message_timestamp: result.message_id,
          message_link: `https://mock.slack.invalid/archives/${args.channel_id}/${result.message_id}`,
        },
      ];
    case "stripe_create_invoice":
      return [
        { customer: args.customer_id },
        {
          id: result.invoice_id,
          object: "invoice",
          status: result.status,
          amount_due: result.amount_due,
        },
      ];
    case "stripe_create_invoice_item":
      return [
        {
          customer: args.customer_id,
          invoice: args.invoice_id,
          amount: args.amount,
          currency: args.currency,
          description: args.description,
        },
        {
          id: result.invoice_item_id,
          object: "invoiceitem",
          invoice: args.invoice_id,
          amount: args.amount,
          currency: args.currency,
          description: args.description,
        },
      ];
    case "stripe_finalize_invoice":
      return [
        { invoice: args.invoice_id },
        {
          id: result.invoice_id,
          object: "invoice",
          status: result.status,
          amount_due: 30000,
          hosted_invoice_url: result.hosted_invoice_url,
        },
      ];
    case "github_create_issue": {
      const [owner, repo] = args.repository.split("/");
      return [
        {
          method: "create",
          owner,
          repo,
          title: args.title,
          body: args.body,
          labels: args.labels,
        },
        { number: result.number, html_url: result.url, state: "open" },
      ];
    }
    case "sentry_get_issue":
      return [
        {
          organizationSlug: args.organization_slug,
          issueId: args.issue_id,
        },
        `# ${result.title}\n\nIssue: ${args.issue_id}\nEvents: ${result.event_count}\nDeploy: ${result.deploy}\nSeverity: ${result.severity}`,
      ];
    case "photoshop_export_image":
    case "photoshop_crop_image":
    case "premiere_export_video":
    case "acrobat_export_pdf":
      return [
        args,
        {
          ...result,
          content: Buffer.from(
            `mock-artifact:${result.artifact_path}`,
          ).toString("base64"),
          share_url: shareUrlFor(result.artifact_path),
        },
      ];
    default:
      return [args, result];
  }
}

export function workflowContract(intent, args, result) {
  const contract = C[intent];
  if (!contract) throw new Error(`missing explicit MCP contract for ${intent}`);
  const [expectedArguments, expectedResult] = transform(intent, args, result);
  return { ...contract, intent, expectedArguments, expectedResult };
}

export const MCP_WORKFLOW_CONTRACT_COUNT = Object.keys(C).length;
