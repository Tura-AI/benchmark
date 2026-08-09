#!/usr/bin/env python3
"""Independent verifier for one stateful mock MCP workflow task."""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class VerificationFailure(AssertionError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise VerificationFailure(f"expected JSON object: {path}")
    return value


def contains(actual: Any, expected: Any, location: str) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            raise VerificationFailure(f"{location} is not an object")
        for key, value in expected.items():
            if key not in actual:
                raise VerificationFailure(f"{location}.{key} is missing")
            contains(actual[key], value, f"{location}.{key}")
        return
    if isinstance(expected, list):
        if actual != expected:
            raise VerificationFailure(f"{location}: expected {expected!r}, got {actual!r}")
        return
    if actual != expected:
        raise VerificationFailure(f"{location}: expected {expected!r}, got {actual!r}")


def get_path(root: dict[str, Any], dotted_path: str) -> Any:
    current: Any = root
    for component in dotted_path.split("."):
        if not isinstance(current, dict) or component not in current:
            raise VerificationFailure(f"state path is missing: {dotted_path}")
        current = current[component]
    return current


def json_type_matches(value: Any, expected: str) -> bool:
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }.get(expected, True)


def validate_schema(value: Any, schema: dict[str, Any], location: str) -> None:
    expected_type = schema.get("type")
    if isinstance(expected_type, str) and not json_type_matches(value, expected_type):
        raise VerificationFailure(f"{location} must be {expected_type}")
    if "enum" in schema and value not in schema["enum"]:
        raise VerificationFailure(f"{location} is outside enum {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        raise VerificationFailure(f"{location} does not match const")
    if isinstance(value, str) and isinstance(schema.get("pattern"), str):
        if re.search(schema["pattern"], value) is None:
            raise VerificationFailure(
                f"{location} does not match pattern {schema['pattern']!r}"
            )
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        missing = [name for name in schema.get("required", []) if name not in value]
        if missing:
            raise VerificationFailure(f"{location} is missing {missing}")
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(value) - set(properties))
            if unknown:
                raise VerificationFailure(f"{location} has unknown properties {unknown}")
        for name, child in properties.items():
            if name in value and isinstance(child, dict):
                validate_schema(value[name], child, f"{location}.{name}")
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            validate_schema(item, schema["items"], f"{location}[{index}]")


def normalize_arguments(
    arguments: dict[str, Any], normalization: dict[str, str]
) -> dict[str, Any]:
    normalized = json.loads(json.dumps(arguments))
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
            raise VerificationFailure(
                f"unsupported argument normalization rule: {rule}"
            )
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
    raise VerificationFailure(f"unsupported argument assertion operator: {operator}")


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


def verify_workflow() -> None:
    scenario_path = Path(os.environ["MCP_WORKFLOW_SCENARIO"])
    state_path = Path(os.environ["MCP_WORKFLOW_STATE"])
    trace_path = Path(os.environ["MCP_WORKFLOW_TRACE"])
    scenario = load_json(scenario_path)
    state = load_json(state_path)
    if not trace_path.is_file():
        raise VerificationFailure("MCP trace is missing")
    trace = [json.loads(line) for line in trace_path.read_text(encoding="utf-8").splitlines() if line]
    methods = [row.get("method") for row in trace]
    for required in ("initialize", "notifications/initialized", "tools/list"):
        if required not in methods:
            raise VerificationFailure(f"MCP lifecycle method is missing: {required}")
    initialize_index = methods.index("initialize")
    initialized_index = methods.index("notifications/initialized")
    list_index = methods.index("tools/list")
    if not initialize_index < initialized_index < list_index:
        raise VerificationFailure(f"invalid MCP lifecycle order: {methods}")
    initialize = trace[initialize_index]
    initialize_result = initialize.get("response") or {}
    if initialize_result.get("protocolVersion") != "2025-06-18":
        raise VerificationFailure("MCP protocol version was not negotiated")
    if not initialize_result.get("capabilities", {}).get("tools"):
        raise VerificationFailure("server did not declare tools capability")

    listed = trace[list_index].get("response", {}).get("tools")
    if not isinstance(listed, list):
        raise VerificationFailure("tools/list did not return a tools array")
    listed_by_name = {tool.get("name"): tool for tool in listed}
    if len(listed_by_name) != len(listed):
        raise VerificationFailure("tools/list contains duplicate tool names")
    expected_by_name: dict[str, dict[str, Any]] = {}
    for step in scenario["steps"]:
        contract = step.get("contract", {})
        if contract.get("fidelity") not in {"official-mcp", "vendor-api-adapter"}:
            raise VerificationFailure(f"invalid contract fidelity for {step['stepId']}")
        if not str(contract.get("source", "")).startswith("https://"):
            raise VerificationFailure(f"contract source missing for {step['stepId']}")
        expected_by_name.setdefault(step["tool"], step)
    if set(listed_by_name) != set(expected_by_name):
        raise VerificationFailure(
            f"tools/list mismatch; expected {sorted(expected_by_name)}, got {sorted(listed_by_name)}"
        )
    for name, step in expected_by_name.items():
        definition = listed_by_name[name]
        for field in ("inputSchema", "annotations"):
            if definition.get(field) != step.get(field):
                raise VerificationFailure(f"tools/list {name}.{field} differs from scenario contract")
        if step.get("outputSchema") is None:
            if "outputSchema" in definition:
                raise VerificationFailure(f"tools/list {name} unexpectedly declares outputSchema")
        elif definition.get("outputSchema") != step.get("outputSchema"):
            raise VerificationFailure(f"tools/list {name}.outputSchema differs from scenario contract")

    trace_calls = [row for row in trace if row.get("method") == "tools/call"]
    successful_trace_calls = [
        row
        for row in trace_calls
        if not (row.get("response") or {}).get("isError", False)
    ]
    state_calls = [call for call in state.get("calls", []) if call.get("ok")]
    actual_steps = [call.get("stepId") for call in state_calls]
    positions = {step_id: index for index, step_id in enumerate(actual_steps)}
    if len(positions) != len(actual_steps):
        raise VerificationFailure(f"workflow step was committed more than once: {actual_steps}")
    for step in scenario["steps"]:
        if step["stepId"] not in positions:
            continue
        late_dependencies = [
            dependency
            for dependency in step.get("requires", [])
            if dependency not in positions or positions[dependency] >= positions[step["stepId"]]
        ]
        if late_dependencies:
            raise VerificationFailure(
                f"dependency order violated for {step['stepId']}: {late_dependencies}"
            )
    if len(successful_trace_calls) != len(state_calls):
        raise VerificationFailure("successful trace calls and state transitions differ")
    steps_by_id = {step["stepId"]: step for step in scenario["steps"]}
    for index, (trace_call, state_call) in enumerate(zip(successful_trace_calls, state_calls)):
        step = steps_by_id.get(state_call.get("stepId"))
        if step is None:
            raise VerificationFailure(f"unknown state stepId at call {index}")
        arguments = normalize_arguments(
            trace_call.get("params", {}).get("arguments", {}),
            step.get("argumentNormalization", {}),
        )
        response = trace_call.get("response") or {}
        content = response.get("content") or []
        if not content or content[0].get("type") != "text":
            raise VerificationFailure(f"{step['tool']} omitted text content")
        validate_schema(arguments, step["inputSchema"], f"call[{index}].arguments")
        if step.get("responseMode") == "text-only":
            if "structuredContent" in response:
                raise VerificationFailure(f"{step['tool']} unexpectedly returned structuredContent")
            if content[0].get("text") != state_call.get("result"):
                raise VerificationFailure(f"{step['tool']} text and committed state result differ")
        else:
            structured = response.get("structuredContent")
            if structured is None:
                raise VerificationFailure(f"{step['tool']} omitted structuredContent")
            if json.loads(content[0].get("text", "null")) != structured:
                raise VerificationFailure(f"{step['tool']} text and structuredContent differ")
            if structured != state_call.get("result"):
                raise VerificationFailure(f"{step['tool']} response and committed state result differ")
            validate_schema(structured, step["outputSchema"], f"call[{index}].result")

    for step in scenario["steps"]:
        matches = [call for call in state_calls if call.get("stepId") == step["stepId"]]
        if not matches:
            raise VerificationFailure(f"missing successful state transition: {step['tool']}")
        normalization = step.get("argumentNormalization", {})
        if not any(
            arguments_match(
                normalize_arguments(call.get("arguments", {}), normalization), step
            )
            for call in matches
        ):
            raise VerificationFailure(
                f"{step['tool']} failed its critical argument assertions"
            )
    for dotted_path, expected in scenario.get("expectedState", {}).items():
        contains(get_path(state, dotted_path), expected, f"state.{dotted_path}")


def _matches(actual: Any, expected: Any, location: str) -> bool:
    try:
        contains(actual, expected, location)
        return True
    except VerificationFailure:
        return False


def verify_task() -> bool:
    try:
        verify_workflow()
    except Exception as exc:
        print(f"FAIL [mcp_workflow]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [mcp_workflow]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
