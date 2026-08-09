Use `mcp_workspace` for every external service operation in this task. Pass native MCP `tools/call` parameters as `{"name": ..., "arguments": ...}`.

Available tools:

- `search_files`: Find all media assets for an ecommerce ad. [official-mcp]
- `premiere_create_project`: Create the Premiere ad project. [vendor-api-adapter]
- `premiere_import_media_batch`: Import multiple media assets into Premiere. [vendor-api-adapter]
- `premiere_trim_clip`: Trim the ad video to a precise duration. [vendor-api-adapter]
- `premiere_add_audio`: Add an audio clip to a Premiere sequence at a specified gain. [vendor-api-adapter]
- `premiere_export_video`: Export the finished ad video. [vendor-api-adapter]
- `photoshop_create_thumbnail`: Create a sized thumbnail with a text layer from a source image. [vendor-api-adapter]
- `photoshop_export_image`: Export the ad thumbnail from Photoshop. [vendor-api-adapter]
- `send_message`: Post a Slack message containing generated artifact URLs. [official-mcp]

The services are deterministic mocks. Official tools mirror documented vendor MCP names, parameters, and response behavior; vendor-api-adapter tools are explicitly namespaced where an exact public MCP schema or deterministic response shape is unavailable. The MCP handshake, schemas, calls, dependencies, state transitions, trace, and verifier are real.
