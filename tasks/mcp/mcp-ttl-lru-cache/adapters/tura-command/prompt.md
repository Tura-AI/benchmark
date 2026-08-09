Use `mcp_workspace` for every workspace read, search, list, and mutation in this task.

Pass MCP `tools/call` parameters unchanged as JSON:

```json
{ "name": "read_file", "arguments": { "path": "src/example.py" } }
```

Available task-local MCP tools:

- `read_file`: Read one UTF-8 text file from the isolated task workspace.
- `write_file`: Create or replace one UTF-8 text file in the isolated task workspace.
- `list_directory`: List files and directories directly below a workspace-relative directory.
- `make_directory`: Create a workspace-relative directory and missing parents.
- `move_file`: Move or rename a file or directory within the isolated workspace.
- `delete_file`: Delete one file or an empty directory inside the isolated workspace.
- `search_files`: Search workspace-relative paths and UTF-8 file contents for a text query.

Do not use shell or built-in file-edit commands for task workspace operations.
