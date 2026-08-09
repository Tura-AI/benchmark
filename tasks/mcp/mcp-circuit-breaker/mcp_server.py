#!/usr/bin/env python3
"""Task-local, dependency-free filesystem MCP server over stdio JSON-RPC."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any


TOOLS = [
    {
        "name": "read_file",
        "description": "Read one UTF-8 text file from the isolated task workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "minLength": 1}},
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "write_file",
        "description": "Create or replace one UTF-8 text file in the isolated task workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "minLength": 1},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_directory",
        "description": "List files and directories directly below a workspace-relative directory.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "default": "."}},
            "additionalProperties": False,
        },
    },
    {
        "name": "make_directory",
        "description": "Create a workspace-relative directory and missing parents.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "minLength": 1}},
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "move_file",
        "description": "Move or rename a file or directory within the isolated workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "minLength": 1},
                "destination": {"type": "string", "minLength": 1},
            },
            "required": ["source", "destination"],
            "additionalProperties": False,
        },
    },
    {
        "name": "delete_file",
        "description": "Delete one file or an empty directory inside the isolated workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "minLength": 1}},
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "search_files",
        "description": "Search workspace-relative paths and UTF-8 file contents for a text query.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "path": {"type": "string", "default": "."},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
]

RESERVED_COMPONENTS = frozenset({".git", ".tura"})


class Server:
    def __init__(self, workspace: Path, trace_path: Path) -> None:
        self.root = workspace.resolve()
        self.trace_path = trace_path.resolve()
        self.trace_path.parent.mkdir(parents=True, exist_ok=True)

    def resolve(self, relative: str, *, allow_root: bool = True) -> Path:
        candidate = (self.root / relative).resolve()
        try:
            inside = os.path.commonpath([str(self.root), str(candidate)]) == str(self.root)
        except ValueError:
            inside = False
        if not inside or (not allow_root and candidate == self.root):
            raise ValueError(f"path escapes task workspace: {relative}")
        if self.is_reserved(candidate):
            raise ValueError(f"path is reserved for benchmark runtime state: {relative}")
        return candidate

    def is_reserved(self, candidate: Path) -> bool:
        relative = candidate.relative_to(self.root)
        return any(part in RESERVED_COMPONENTS for part in relative.parts)

    def record(self, request: dict[str, Any], response: dict[str, Any] | None) -> None:
        row = {
            "jsonrpc": request.get("jsonrpc"),
            "id": request.get("id"),
            "method": request.get("method"),
            "params": request.get("params", {}),
        }
        if response is not None:
            row["response"] = response.get("result", response.get("error"))
        with self.trace_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        method = request.get("method")
        request_id = request.get("id")
        if request_id is None:
            self.record(request, None)
            return None
        try:
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "tura-task-filesystem", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params") or {}
                output = self.call_tool(params.get("name"), params.get("arguments") or {})
                result = {"content": [{"type": "text", "text": output}], "isError": False}
            elif method == "ping":
                result = {}
            else:
                raise LookupError(f"unsupported MCP method: {method}")
            response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except Exception as exc:  # MCP tool failures are returned as structured results.
            if method == "tools/call":
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}],
                        "isError": True,
                    },
                }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32603, "message": f"{type(exc).__name__}: {exc}"},
                }
        self.record(request, response)
        return response

    def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        if name == "read_file":
            return self.resolve(arguments["path"]).read_text(encoding="utf-8")
        if name == "write_file":
            target = self.resolve(arguments["path"], allow_root=False)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(arguments["content"], encoding="utf-8", newline="\n")
            return json.dumps({"written": target.relative_to(self.root).as_posix()})
        if name == "list_directory":
            target = self.resolve(arguments.get("path", "."))
            rows = [
                {"name": child.name, "type": "directory" if child.is_dir() else "file"}
                for child in sorted(target.iterdir(), key=lambda item: item.name.lower())
                if not self.is_reserved(child.resolve())
            ]
            return json.dumps(rows, ensure_ascii=False)
        if name == "make_directory":
            target = self.resolve(arguments["path"], allow_root=False)
            target.mkdir(parents=True, exist_ok=True)
            return json.dumps({"created": target.relative_to(self.root).as_posix()})
        if name == "move_file":
            source = self.resolve(arguments["source"], allow_root=False)
            destination = self.resolve(arguments["destination"], allow_root=False)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(destination))
            return json.dumps({"moved": [arguments["source"], arguments["destination"]]})
        if name == "delete_file":
            target = self.resolve(arguments["path"], allow_root=False)
            if target.is_dir():
                target.rmdir()
            else:
                target.unlink()
            return json.dumps({"deleted": arguments["path"]})
        if name == "search_files":
            base = self.resolve(arguments.get("path", "."))
            query = arguments["query"].casefold()
            maximum = int(arguments.get("max_results", 50))
            matches: list[dict[str, Any]] = []
            candidates = [base] if base.is_file() else base.rglob("*")
            for candidate in candidates:
                if self.is_reserved(candidate.resolve()) or not candidate.is_file():
                    continue
                relative = candidate.relative_to(self.root).as_posix()
                if query in relative.casefold():
                    matches.append({"path": relative, "line": None})
                else:
                    try:
                        for number, line in enumerate(candidate.read_text(encoding="utf-8").splitlines(), 1):
                            if query in line.casefold():
                                matches.append({"path": relative, "line": number, "text": line[:500]})
                                break
                    except (UnicodeDecodeError, OSError):
                        pass
                if len(matches) >= maximum:
                    break
            return json.dumps(matches, ensure_ascii=False)
        raise LookupError(f"unknown MCP tool: {name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--trace", required=True, type=Path)
    args = parser.parse_args()
    server = Server(args.workspace, args.trace)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = server.handle(request)
        except Exception as exc:
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"{type(exc).__name__}: {exc}"},
            }
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
