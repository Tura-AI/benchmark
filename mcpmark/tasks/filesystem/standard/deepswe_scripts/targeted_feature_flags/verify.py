#!/usr/bin/env python3
"""Self-contained behavioral verifier for targeted_feature_flags."""

from __future__ import annotations

import asyncio
import copy
import dataclasses
import importlib
import json
import math
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


class VerificationFailure(AssertionError):
    pass


def check(condition: Any, message: str) -> None:
    if not condition:
        raise VerificationFailure(message)


def expect_raises(exc_type: type[BaseException] | tuple[type[BaseException], ...], fn: Callable, *args, **kwargs) -> BaseException:
    try:
        fn(*args, **kwargs)
    except exc_type as exc:
        return exc
    except Exception as exc:  # pragma: no cover - diagnostic path
        raise VerificationFailure(
            f"expected {exc_type}, got {type(exc).__name__}: {exc}"
        ) from exc
    raise VerificationFailure(f"expected {exc_type} to be raised")


async def expect_raises_async(exc_type, awaitable) -> BaseException:
    try:
        await awaitable
    except exc_type as exc:
        return exc
    except Exception as exc:  # pragma: no cover - diagnostic path
        raise VerificationFailure(
            f"expected {exc_type}, got {type(exc).__name__}: {exc}"
        ) from exc
    raise VerificationFailure(f"expected {exc_type} to be raised")


def load_exports(*names: str):
    test_dir = os.environ.get("FILESYSTEM_TEST_DIR")
    if not test_dir:
        raise VerificationFailure("FILESYSTEM_TEST_DIR is required")
    root = Path(test_dir).resolve()
    check((root / "relaykit" / "__init__.py").is_file(), "relaykit package is missing")
    sys.path.insert(0, str(root))
    for module_name in list(sys.modules):
        if module_name == "relaykit" or module_name.startswith("relaykit."):
            del sys.modules[module_name]
    package = importlib.import_module("relaykit")
    missing = [name for name in names if not hasattr(package, name)]
    check(not missing, f"relaykit is missing public exports: {missing}")
    return tuple(getattr(package, name) for name in names)


def verify_targeted_feature_flags() -> None:
    FeatureFlagEngine, FlagConfigError = load_exports("FeatureFlagEngine", "FlagConfigError")
    definitions = {
        "new-ui": {
            "default": False,
            "rules": [
                {"when": {"country": {"in": ["FR", "DE"]}, "age": {"gte": 18}}, "value": True},
                {"when": {"plan": {"eq": "blocked"}}, "value": False},
            ],
        },
        "theme": {
            "default": "classic",
            "rollout": [
                {"value": "blue", "percentage": 40},
                {"value": "green", "percentage": 60},
            ],
        },
    }
    original = copy.deepcopy(definitions)
    engine = FeatureFlagEngine(definitions, salt="stable")
    matched = engine.evaluate("new-ui", {"country": "FR", "age": 20, "plan": "pro"}, identity="u1")
    check(matched.value is True and matched.rule_index == 0, "ordered targeting rule failed")
    defaulted = engine.evaluate("new-ui", {"country": "US", "age": 20}, identity="u2")
    check(defaulted.value is False and "default" in defaulted.reason.lower(), "default evaluation/reason failed")
    first = engine.evaluate("theme", {}, identity="same-user").value
    check(all(FeatureFlagEngine(definitions, salt="stable").evaluate("theme", {}, identity="same-user").value == first for _ in range(5)), "rollout assignment is not stable")
    check(first in {"blue", "green"}, "rollout returned an undeclared variant")
    check(definitions == original, "definitions were mutated")
    expect_raises(FlagConfigError, FeatureFlagEngine, {"bad": {"default": "x", "rollout": [{"value": "x", "percentage": 80}]}})
    expect_raises(Exception, engine.evaluate, "missing", {}, identity="u")

def verify_task() -> bool:
    try:
        verify_targeted_feature_flags()
    except Exception as exc:
        print(f"FAIL [targeted_feature_flags]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [targeted_feature_flags]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
