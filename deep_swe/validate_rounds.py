#!/usr/bin/env python3
"""Validate one agent-round JSONL artifact against the benchmark contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schema"
sys.path.insert(0, str(SCHEMA_DIR))

from validate import validator  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    errors: list[str] = []
    rounds = 0
    schema_validator = validator("agent-round.schema.json")
    with args.path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            rounds += 1
            value = json.loads(line)
            for error in schema_validator.iter_errors(value):
                location = ".".join(str(part) for part in error.absolute_path) or "$"
                errors.append(f"line {line_number} [{location}]: {error.message}")
            tool_calls = value.get("toolCalls")
            usage = value.get("usage")
            if not isinstance(tool_calls, list):
                errors.append(f"line {line_number}: toolCalls must be an array")
            if not isinstance(usage, dict):
                errors.append(f"line {line_number}: usage must be an object")
            else:
                for name in ("inputTokens", "cacheInputTokens", "outputTokens", "reasoningTokens", "totalTokens"):
                    if not isinstance(usage.get(name), (int, float)):
                        errors.append(f"line {line_number}: usage.{name} must be numeric")
                if not isinstance(usage.get("totalTokens"), (int, float)) or usage["totalTokens"] <= 0:
                    errors.append(f"line {line_number}: usage.totalTokens must be positive")
    if rounds == 0:
        errors.append("no round contracts were produced")
    print(json.dumps({"path": str(args.path), "rounds": rounds, "ok": not errors, "errors": errors}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
