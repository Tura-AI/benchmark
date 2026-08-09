#!/usr/bin/env python3
"""Dependency-free, scenario-driven mock workflow MCP server.

The server speaks real MCP JSON-RPC over stdio. Vendor data is deterministic
and stored outside the agent workspace so the only supported interaction path
is through tools/list and tools/call.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ToolFailure(ValueError):
    """A schema, dependency, or workflow precondition failed."""


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ToolFailure(f"expected a JSON object in {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary.replace(path)


def json_type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_schema(value: Any, schema: dict[str, Any], location: str = "arguments") -> None:
    expected = schema.get("type")
    if isinstance(expected, str) and not json_type_matches(value, expected):
        raise ToolFailure(f"{location} must be {expected}")
    if "enum" in schema and value not in schema["enum"]:
        raise ToolFailure(f"{location} must be one of {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        raise ToolFailure(f"{location} must equal {schema['const']!r}")
    if isinstance(value, str) and len(value) < int(schema.get("minLength", 0)):
        raise ToolFailure(f"{location} is too short")
    if isinstance(value, str) and isinstance(schema.get("pattern"), str):
        if re.search(schema["pattern"], value) is None:
            raise ToolFailure(
                f"{location} must match JSON Schema pattern {schema['pattern']!r}"
            )
    if isinstance(value, list):
        if len(value) < int(schema.get("minItems", 0)):
            raise ToolFailure(f"{location} has too few items")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_schema(item, item_schema, f"{location}[{index}]")
    if isinstance(value, dict):
        required = schema.get("required", [])
        missing = [name for name in required if name not in value]
        if missing:
            raise ToolFailure(f"{location} is missing required fields: {missing}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(value) - set(properties))
            if unknown:
                raise ToolFailure(f"{location} has unknown fields: {unknown}")
        for name, child in properties.items():
            if name in value and isinstance(child, dict):
                validate_schema(value[name], child, f"{location}.{name}")


def normalize_arguments(
    arguments: dict[str, Any], normalization: dict[str, str]
) -> dict[str, Any]:
    normalized = copy.deepcopy(arguments)
    for dotted_path, rule in normalization.items():
        components = dotted_path.split(".")
        current: Any = normalized
        for component in components[:-1]:
            if not isinstance(current, dict) or component not in current:
                current = None
                break
            current = current[component]
        if not isinstance(current, dict) or components[-1] not in current:
            continue
        value = current[components[-1]]
        if rule == "lowercase" and isinstance(value, str):
            current[components[-1]] = value.strip().lower()
        elif rule == "trim" and isinstance(value, str):
            current[components[-1]] = value.strip()
        else:
            raise ToolFailure(f"unsupported argument normalization rule: {rule}")
    return normalized


_MISSING = object()


def read_path(root: Any, dotted_path: str) -> Any:
    current = root
    for component in dotted_path.split("."):
        if not isinstance(current, dict) or component not in current:
            return _MISSING
        current = current[component]
    return current


def normalize_comparable(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(unicodedata.normalize("NFKC", value).split())
    if isinstance(value, dict):
        return {key: normalize_comparable(child) for key, child in value.items()}
    if isinstance(value, list):
        return [normalize_comparable(child) for child in value]
    return value


def parse_instant(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def assertion_matches(
    arguments: dict[str, Any], expected_arguments: dict[str, Any], assertion: dict[str, Any]
) -> bool:
    actual = read_path(arguments, assertion["path"])
    if actual is _MISSING:
        return False
    operator = assertion["operator"]
    if operator == "contains-all":
        if not isinstance(actual, str):
            return False
        haystack = normalize_comparable(actual).casefold()
        return all(
            normalize_comparable(value).casefold() in haystack
            for value in assertion.get("values", [])
            if isinstance(value, str)
        )
    expected = read_path(expected_arguments, assertion["path"])
    if expected is _MISSING:
        return False
    if operator == "normalized-equals":
        return normalize_comparable(actual) == normalize_comparable(expected)
    if operator == "instant-equals":
        actual_instant = parse_instant(actual)
        expected_instant = parse_instant(expected)
        return actual_instant is not None and actual_instant == expected_instant
    if operator == "set-equals":
        if not isinstance(actual, list) or not isinstance(expected, list):
            return False
        canonical = lambda item: json.dumps(
            normalize_comparable(item), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        return sorted(canonical(item) for item in actual) == sorted(
            canonical(item) for item in expected
        )
    raise ToolFailure(f"unsupported argument assertion operator: {operator}")


def assertion_failure(
    arguments: dict[str, Any], expected_arguments: dict[str, Any], assertion: dict[str, Any]
) -> str | None:
    if assertion_matches(arguments, expected_arguments, assertion):
        return None
    dotted_path = assertion["path"]
    actual = read_path(arguments, dotted_path)
    if actual is _MISSING:
        return f"arguments.{dotted_path} is required for this workflow operation"
    operator = assertion["operator"]
    if operator == "instant-equals":
        return f"arguments.{dotted_path} must identify the required workflow instant"
    if operator == "set-equals":
        return f"arguments.{dotted_path} does not match the required recipient/resource set"
    if operator == "contains-all":
        missing = [
            value
            for value in assertion.get("values", [])
            if isinstance(value, str)
            and normalize_comparable(value).casefold()
            not in normalize_comparable(actual).casefold()
        ]
        return f"arguments.{dotted_path} is missing required terms: {missing}"
    return f"arguments.{dotted_path} does not identify the required workflow resource/value"


def arguments_match(arguments: dict[str, Any], step: dict[str, Any]) -> bool:
    assertions = step.get("argumentAssertions")
    if not isinstance(assertions, list):
        return normalize_comparable(arguments) == normalize_comparable(
            step.get("expectedArguments", {})
        )
    return all(
        assertion_matches(arguments, step.get("expectedArguments", {}), assertion)
        for assertion in assertions
    )


def render(value: Any, arguments: dict[str, Any]) -> Any:
    """Expand an exact {{arguments.path}} placeholder in configured effects/results."""
    if isinstance(value, str) and value.startswith("{{arguments.") and value.endswith("}}"):
        current: Any = arguments
        for component in value[12:-2].split("."):
            if not isinstance(current, dict) or component not in current:
                raise ToolFailure(f"missing template argument: {value}")
            current = current[component]
        return copy.deepcopy(current)
    if isinstance(value, dict):
        return {key: render(child, arguments) for key, child in value.items()}
    if isinstance(value, list):
        return [render(child, arguments) for child in value]
    return copy.deepcopy(value)


def set_path(root: dict[str, Any], dotted_path: str, value: Any) -> None:
    components = dotted_path.split(".")
    current = root
    for component in components[:-1]:
        child = current.get(component)
        if child is None:
            child = {}
            current[component] = child
        if not isinstance(child, dict):
            raise ToolFailure(f"state path is not an object: {dotted_path}")
        current = child
    current[components[-1]] = value


class WorkflowServer:
    def __init__(self, scenario_path: Path, state_path: Path, trace_path: Path) -> None:
        self.scenario = read_json(scenario_path.resolve())
        self.state_path = state_path.resolve()
        self.trace_path = trace_path.resolve()
        self.trace_path.parent.mkdir(parents=True, exist_ok=True)
        self.steps = list(self.scenario["steps"])
        self.initialized = False
        self.initialize_seen = False
        self.protocol_version: str | None = None
        if not self.state_path.exists():
            state = copy.deepcopy(self.scenario.get("initialState", {}))
            state["scenarioId"] = self.scenario["id"]
            state["calls"] = []
            write_json(self.state_path, state)

    def tools(self) -> list[dict[str, Any]]:
        tools: dict[str, dict[str, Any]] = {}
        for step in self.steps:
            definition = {
                "name": step["tool"],
                "description": step["description"],
                "inputSchema": step["inputSchema"],
                "annotations": step.get("annotations", {}),
            }
            if step.get("outputSchema") is not None:
                definition["outputSchema"] = step["outputSchema"]
            previous = tools.get(step["tool"])
            if previous is not None:
                for field in ("inputSchema", "outputSchema", "annotations"):
                    if previous.get(field) != definition.get(field):
                        raise ToolFailure(
                            f"conflicting contract for repeated tool {step['tool']}"
                        )
                continue
            tools[step["tool"]] = definition
        return list(tools.values())

    def record(self, request: dict[str, Any], response: dict[str, Any] | None) -> None:
        row: dict[str, Any] = {
            "jsonrpc": request.get("jsonrpc"),
            "id": request.get("id"),
            "method": request.get("method"),
            "params": request.get("params", {}),
        }
        if response is not None:
            row["response"] = response.get("result", response.get("error"))
        with self.trace_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    def call_tool(self, name: str, arguments: dict[str, Any]) -> tuple[Any, str]:
        candidates = [step for step in self.steps if step["tool"] == name]
        if not candidates:
            raise ToolFailure(f"unknown workflow tool: {name}")
        state = read_json(self.state_path)
        completed = [
            call["stepId"]
            for call in state.get("calls", [])
            if call.get("ok") and call.get("stepId")
        ]
        candidates = [step for step in candidates if step["stepId"] not in completed]
        if not candidates:
            raise ToolFailure(f"all workflow steps for {name} are already complete")
        ready = [
            step
            for step in candidates
            if all(required in completed for required in step.get("requires", []))
        ]
        if not ready:
            missing = sorted(
                {
                    required
                    for step in candidates
                    for required in step.get("requires", [])
                    if required not in completed
                }
            )
            raise ToolFailure(
                f"workflow precondition failed; complete these steps first: {missing}"
            )
        matching = []
        failures = []
        for candidate in ready:
            normalized = normalize_arguments(
                arguments, candidate.get("argumentNormalization", {})
            )
            validate_schema(normalized, candidate["inputSchema"])
            if arguments_match(normalized, candidate):
                matching.append((candidate, normalized))
            else:
                assertions = candidate.get("argumentAssertions", [])
                details = [
                    failure
                    for assertion in assertions
                    if (
                        failure := assertion_failure(
                            normalized,
                            candidate.get("expectedArguments", {}),
                            assertion,
                        )
                    )
                ]
                failures.append(f"{candidate['stepId']}: {'; '.join(details)}")
        if not matching:
            raise ToolFailure(
                "tool call rejected before state mutation; " + " | ".join(failures)
            )
        step, arguments = matching[0]
        validate_schema(arguments, step["inputSchema"])
        missing = [required for required in step.get("requires", []) if required not in completed]
        if missing:
            raise ToolFailure(f"workflow precondition failed; complete these steps first: {missing}")
        result = render(step.get("result", {"ok": True}), arguments)
        if step.get("outputSchema") is not None:
            validate_schema(result, step["outputSchema"], "result")
        effects = step.get("effects", {})
        for target, configured in effects.get("set", {}).items():
            set_path(state, target, render(configured, arguments))
        for target, configured in effects.get("append", {}).items():
            current: Any = state
            components = target.split(".")
            for component in components[:-1]:
                current = current.setdefault(component, {})
            collection = current.setdefault(components[-1], [])
            if not isinstance(collection, list):
                raise ToolFailure(f"state path is not an array: {target}")
            collection.append(render(configured, arguments))
        state.setdefault("calls", []).append(
            {
                "index": len(state.get("calls", [])) + 1,
                "stepId": step["stepId"],
                "tool": name,
                "arguments": copy.deepcopy(arguments),
                "result": copy.deepcopy(result),
                "ok": True,
            }
        )
        state["updatedAt"] = datetime.now(timezone.utc).isoformat()
        write_json(self.state_path, state)
        return result, step.get("responseMode", "structured-json")

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        method = request.get("method")
        request_id = request.get("id")
        if request_id is None:
            if method == "notifications/initialized":
                if not self.initialize_seen:
                    self.record(request, None)
                    return None
                self.initialized = True
            self.record(request, None)
            return None
        try:
            if method == "initialize":
                if self.initialize_seen:
                    raise ToolFailure("initialize may only be called once")
                params = request.get("params") or {}
                validate_schema(
                    params,
                    {
                        "type": "object",
                        "properties": {
                            "protocolVersion": {"type": "string"},
                            "capabilities": {"type": "object"},
                            "clientInfo": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "version": {"type": "string"},
                                },
                                "required": ["name", "version"],
                            },
                        },
                        "required": ["protocolVersion", "capabilities", "clientInfo"],
                    },
                    "initialize.params",
                )
                self.initialize_seen = True
                self.protocol_version = "2025-06-18"
                result = {
                    "protocolVersion": self.protocol_version,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {
                        "name": self.scenario.get("serverName", "tura-mock-workflow"),
                        "version": "2.0.0",
                    },
                }
            elif method == "tools/list":
                if not self.initialized:
                    raise ToolFailure("notifications/initialized is required before tools/list")
                params = request.get("params") or {}
                if params.get("cursor") not in (None, ""):
                    raise ToolFailure("invalid tools/list cursor")
                result = {"tools": self.tools()}
            elif method == "tools/call":
                if not self.initialized:
                    raise ToolFailure("notifications/initialized is required before tools/call")
                params = request.get("params") or {}
                output, response_mode = self.call_tool(
                    params.get("name"), params.get("arguments") or {}
                )
                if response_mode == "text-only":
                    if not isinstance(output, str):
                        raise ToolFailure("text-only tool result must be a string")
                    result = {
                        "content": [{"type": "text", "text": output}],
                        "isError": False,
                    }
                else:
                    output_text = json.dumps(
                        output, ensure_ascii=False, separators=(",", ":")
                    )
                    result = {
                        "content": [{"type": "text", "text": output_text}],
                        "structuredContent": output,
                        "isError": False,
                    }
            elif method == "ping":
                if not self.initialize_seen:
                    raise ToolFailure("initialize is required before ping")
                result = {}
            else:
                raise ToolFailure(f"unsupported MCP method: {method}")
            response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except Exception as exc:
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--trace", required=True, type=Path)
    parser.add_argument("--scenario", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    args = parser.parse_args()
    if not args.workspace.resolve().is_dir():
        raise SystemExit(f"workspace does not exist: {args.workspace}")
    server = WorkflowServer(args.scenario, args.state, args.trace)
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
