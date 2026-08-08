"""Standalone command_run implementation backed only by mini-swe-agent primitives."""

from __future__ import annotations

import base64
import json
import os
import shlex
import shutil
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

SUBMISSION_COMMAND = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"
DEFAULT_TIMEOUT = int(os.getenv("MSWEA_MACRO_COMMAND_TIMEOUT", "60"))


def active_shell_command_name() -> str:
    return "shell_command" if os.name == "nt" else "bash"


def command_run_parameters() -> dict[str, Any]:
    shell = active_shell_command_name()
    return {
        "type": "object",
        "required": ["commands"],
        "additionalProperties": False,
        "properties": {
            "commands": {
                "type": "array",
                "minItems": 1,
                "maxItems": 20,
                "description": (
                    "Complete all currently known work in one batch and prefer at least five commands during "
                    "real task execution. A single command is valid for task submission or a genuinely atomic "
                    "operation. Same-step commands must be independent; later steps may depend on earlier steps."
                ),
                "items": {
                    "type": "object",
                    "required": ["command_type", "command_line", "step"],
                    "additionalProperties": False,
                    "properties": {
                        "command_type": {
                            "type": "string",
                            "enum": [shell, "apply_patch"],
                            "description": "Internal command name. These are not provider-visible tools.",
                        },
                        "command_line": {
                            "type": "string",
                            "description": (
                                "Shell text for the active shell, or a raw patch beginning with "
                                "*** Begin Patch for apply_patch."
                            ),
                        },
                        "step": {
                            "type": "integer",
                            "minimum": 1,
                            "description": (
                                "Dependency group. Independent reads share a step; commands depending on prior "
                                "output or edits use a later step."
                            ),
                        },
                    },
                },
            }
        },
    }


def command_run_description() -> str:
    shell = active_shell_command_name()
    shell_guidance = (
        "On Windows use PowerShell-compatible commands and prefer rg/Get-Content for inspection."
        if shell == "shell_command"
        else "Use bash command text; do not use zsh-only syntax."
    )
    return (
        "Run mini-swe internal commands as a pure batch+step command runner. This is the only tool exposed to "
        f"the model. Available internal commands: {shell}, apply_patch. Put independent reads/searches in the "
        "same step, edits in a later step, and validation after edits. Include only commands whose inputs are "
        "already known; do not invent a command in the same call that needs unknown output from an earlier step. "
        "During real work, batch all currently useful operations and prefer five or more commands when they are "
        "actually known. For apply_patch, command_line must be the raw focused patch body beginning with "
        "*** Begin Patch, with no heredoc or explanatory wrapper. If a patch fails, later steps are cancelled. "
        f"{shell_guidance} Submit only with one standalone {shell} command: {SUBMISSION_COMMAND}."
    )


def command_run_tool(*, responses_api: bool) -> dict[str, Any]:
    function = {
        "name": "command_run",
        "description": command_run_description(),
        "parameters": command_run_parameters(),
        "strict": True,
    }
    return {"type": "function", **function} if responses_api else {"type": "function", "function": function}


def validate_command_run(arguments: Any) -> dict[str, Any]:
    if not isinstance(arguments, dict) or set(arguments) != {"commands"}:
        raise ValueError("command_run requires exactly one top-level 'commands' array")
    commands = arguments["commands"]
    if not isinstance(commands, list) or not 1 <= len(commands) <= 20:
        raise ValueError("command_run commands must contain between 1 and 20 items")
    allowed = {active_shell_command_name(), "apply_patch"}
    for index, command in enumerate(commands):
        if not isinstance(command, dict):
            raise ValueError(f"command_run command {index} must be an object")
        if set(command) != {"command_type", "command_line", "step"}:
            raise ValueError(
                f"command_run command {index} requires only command_type, command_line, and step"
            )
        if command["command_type"] not in allowed:
            raise ValueError(
                f"unsupported command_type {command['command_type']!r}; expected one of {sorted(allowed)}"
            )
        if not isinstance(command["command_line"], str) or not command["command_line"].strip():
            raise ValueError(f"command_run command {index} command_line must be a non-empty string")
        if not isinstance(command["step"], int) or isinstance(command["step"], bool) or command["step"] < 1:
            raise ValueError(f"command_run command {index} step must be a positive integer")
    return arguments


def action_for_command_run(arguments: dict[str, Any], tool_call_id: str | None) -> dict[str, Any]:
    arguments = validate_command_run(arguments)
    encoded = base64.urlsafe_b64encode(json.dumps(arguments, separators=(",", ":")).encode()).decode()
    executable = [sys.executable, "-m", "minisweagent.macro_command", encoded]
    if os.name == "nt":
        command = f'set "MSWEA_SILENT_STARTUP=1" && {subprocess.list2cmdline(executable)}'
    else:
        command = f"MSWEA_SILENT_STARTUP=1 {shlex.join(executable)}"
    return {
        "command": command,
        "display_command": f"command_run ({len(arguments['commands'])} internal commands)",
        "command_run": arguments,
        "tool_call_id": tool_call_id,
    }


def _workspace_path(root: Path, raw_path: str) -> Path:
    if not raw_path.strip() or Path(raw_path).is_absolute():
        raise ValueError(f"patch path must be workspace-relative: {raw_path!r}")
    path = (root / raw_path).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError(f"patch path escapes workspace: {raw_path!r}") from error
    return path


def _replace_hunk(content: str, hunk: list[str], path: str) -> str:
    old = "\n".join(line[1:] for line in hunk if line[:1] in {" ", "-"})
    new = "\n".join(line[1:] for line in hunk if line[:1] in {" ", "+"})
    if old not in content:
        old_with_newline = f"{old}\n"
        if old_with_newline in content:
            return content.replace(old_with_newline, f"{new}\n", 1)
        raise ValueError(f"patch hunk does not apply to {path}")
    return content.replace(old, new, 1)


def _update_file(path: Path, body: list[str], raw_path: str) -> None:
    if not path.is_file():
        raise ValueError(f"update target does not exist: {raw_path}")
    content = path.read_text(encoding="utf-8")
    hunks: list[list[str]] = []
    current: list[str] = []
    for line in body:
        if line.startswith("@@"):
            if current:
                hunks.append(current)
                current = []
            continue
        if line == "\\ No newline at end of file":
            continue
        if not line.startswith((" ", "+", "-")):
            raise ValueError(f"invalid patch line for {raw_path}: {line!r}")
        current.append(line)
    if current:
        hunks.append(current)
    if not hunks:
        raise ValueError(f"update patch has no hunks: {raw_path}")
    for hunk in hunks:
        content = _replace_hunk(content, hunk, raw_path)
    path.write_text(content, encoding="utf-8", newline="\n")


def apply_patch(patch: str, root: Path) -> str:
    lines = patch.strip().splitlines()
    if len(lines) < 2 or lines[0] != "*** Begin Patch" or lines[-1] != "*** End Patch":
        raise ValueError("apply_patch command_line must begin with *** Begin Patch and end with *** End Patch")
    index = 1
    changed: list[str] = []
    while index < len(lines) - 1:
        header = lines[index]
        prefixes = ("*** Add File: ", "*** Update File: ", "*** Delete File: ")
        prefix = next((candidate for candidate in prefixes if header.startswith(candidate)), None)
        if prefix is None:
            raise ValueError(f"invalid patch file header: {header!r}")
        raw_path = header[len(prefix) :].strip()
        path = _workspace_path(root, raw_path)
        index += 1
        body: list[str] = []
        while index < len(lines) - 1 and not lines[index].startswith(prefixes):
            body.append(lines[index])
            index += 1
        if prefix == "*** Add File: ":
            if path.exists():
                raise ValueError(f"add target already exists: {raw_path}")
            if any(not line.startswith("+") for line in body):
                raise ValueError(f"add patch lines must start with '+': {raw_path}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("\n".join(line[1:] for line in body) + "\n", encoding="utf-8", newline="\n")
        elif prefix == "*** Delete File: ":
            if not path.is_file():
                raise ValueError(f"delete target does not exist: {raw_path}")
            path.unlink()
        else:
            _update_file(path, body, raw_path)
        changed.append(raw_path)
    return "Done!\n" + "\n".join(changed)


def _read_only_shell(command: str) -> bool:
    stripped = command.strip()
    if not stripped or any(token in stripped for token in (">", "| tee", "&& rm", "&& mv", "; rm", "; mv")):
        return False
    words = shlex.split(stripped, posix=os.name != "nt")
    if not words:
        return False
    first = words[0].lower()
    if first in {"ls", "dir", "cat", "rg", "grep", "find", "pwd", "head", "tail", "wc", "type"}:
        return True
    return first == "git" and len(words) > 1 and words[1].lower() in {
        "status",
        "diff",
        "log",
        "show",
        "rev-parse",
        "branch",
    }


def _run_shell(command: str, root: Path, timeout: int = DEFAULT_TIMEOUT) -> dict[str, Any]:
    try:
        environment = os.environ.copy()
        python_dir = str(Path(sys.executable).resolve().parent)
        environment["PATH"] = python_dir + os.pathsep + environment.get("PATH", "")
        environment["VIRTUAL_ENV"] = str(Path(python_dir).parent)
        if os.name == "nt":
            shell = shutil.which("pwsh") or shutil.which("powershell")
            if shell is None:
                raise RuntimeError("PowerShell was not found")
            invocation = [shell, "-NoProfile", "-NonInteractive", "-Command", command]
        else:
            invocation = ["bash", "-lc", command]
        completed = subprocess.run(
            invocation,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            cwd=root,
            env=environment,
            timeout=timeout,
        )
        return {
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout.decode(errors="replace") if isinstance(error.stdout, bytes) else error.stdout or ""
        stderr = error.stderr.decode(errors="replace") if isinstance(error.stderr, bytes) else error.stderr or ""
        return {
            "exit_code": 124,
            "stdout": stdout,
            "stderr": f"{stderr}\ncommand timed out after {timeout}s".strip(),
        }


def _run_item(item: tuple[int, dict[str, Any]], root: Path) -> dict[str, Any]:
    index, command = item
    command_type = command["command_type"]
    try:
        if command_type == "apply_patch":
            output = {"exit_code": 0, "stdout": apply_patch(command["command_line"], root), "stderr": ""}
        else:
            output = _run_shell(command["command_line"], root)
        success = output["exit_code"] == 0
        return {
            "_index": index,
            "step": command["step"],
            "command_type": command_type,
            "command_line": command["command_line"],
            "success": success,
            "output": output,
        }
    except Exception as error:
        return {
            "_index": index,
            "step": command["step"],
            "command_type": command_type,
            "command_line": command["command_line"],
            "success": False,
            "error": str(error),
        }


def execute_command_run(arguments: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    arguments = validate_command_run(arguments)
    root = (root or Path.cwd()).resolve()
    grouped: dict[int, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    previous_step = 0
    for index, original in enumerate(arguments["commands"]):
        command = dict(original)
        requested = command["step"]
        command["step"] = previous_step + 1 if requested < previous_step else requested
        previous_step = command["step"]
        grouped[command["step"]].append((index, command))

    results: list[dict[str, Any]] = []
    cancelled = False
    for step in sorted(grouped):
        items = grouped[step]
        parallel = len(items) > 1 and all(
            command["command_type"] == active_shell_command_name()
            and _read_only_shell(command["command_line"])
            for _, command in items
        )
        if parallel:
            with ThreadPoolExecutor(max_workers=len(items)) as executor:
                step_results = list(executor.map(lambda item: _run_item(item, root), items))
        else:
            step_results = [_run_item(item, root) for item in items]
        results.extend(step_results)
        if any(
            result["command_type"] == "apply_patch" and not result["success"] for result in step_results
        ):
            cancelled = True
            break
    results.sort(key=lambda result: result.pop("_index"))
    output: dict[str, Any] = {"results": results}
    if cancelled:
        output |= {
            "cancelled": True,
            "cancel_reason": "apply_patch failed; command_run stopped before later commands",
        }
    return output


def _decode_payload(encoded: str) -> dict[str, Any]:
    return json.loads(base64.urlsafe_b64decode(encoded.encode()).decode())


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m minisweagent.macro_command <base64-json>", file=sys.stderr)
        return 2
    try:
        output = execute_command_run(_decode_payload(sys.argv[1]))
    except Exception as error:
        print(json.dumps({"results": [], "error": str(error)}, ensure_ascii=False))
        return 2
    for result in output["results"]:
        stdout = result.get("output", {}).get("stdout", "")
        if result["success"] and stdout.lstrip().splitlines()[:1] == ["COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"]:
            print("COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT")
            return 0
    print(json.dumps(output, ensure_ascii=False))
    return 0 if all(result["success"] for result in output["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
