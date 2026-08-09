#!/usr/bin/env python3
"""Self-contained behavioral verifier for safe_query_language."""

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


def verify_safe_query_language() -> None:
    compile_query, QuerySyntaxError = load_exports("compile_query", "QuerySyntaxError")
    query = compile_query("user.age >= 18 AND (country in ['FR', 'DE'] OR plan == 'pro') AND NOT disabled")
    check(query({"user": {"age": 20}, "country": "FR", "disabled": False}), "valid record did not match")
    check(query({"user": {"age": 20}, "country": "US", "plan": "pro", "disabled": False}), "OR branch did not match")
    check(not query({"user": {"age": 17}, "country": "FR", "disabled": False}), "numeric comparison failed")
    check(not query({"country": "FR", "disabled": False}), "missing field did not evaluate safely")
    contains = compile_query("tags contains 'urgent' AND deleted == null")
    check(contains({"tags": ["urgent", "ops"], "deleted": None}), "contains/null failed")
    check(compile_query("name not in ['root', 'admin']")({"name": "user"}), "not in failed")
    check(not compile_query("score > 10")({"score": "100"}), "numeric comparison coerced a string")
    for expression in ("x == 1 trailing", "__import__('os')", "user.run()", "(x == 1"):
        expect_raises(QuerySyntaxError, compile_query, expression)

def verify_task() -> bool:
    try:
        verify_safe_query_language()
    except Exception as exc:
        print(f"FAIL [safe_query_language]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [safe_query_language]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
