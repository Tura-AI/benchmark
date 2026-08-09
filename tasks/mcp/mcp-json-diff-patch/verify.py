#!/usr/bin/env python3
"""Self-contained behavioral verifier for json_diff_patch."""

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


def verify_json_diff_patch() -> None:
    diff, apply_patch, reverse_patch, PatchError = load_exports("diff", "apply_patch", "reverse_patch", "PatchError")
    source = {"a/b": {"~key": 1}, "items": ["a", "b", "c"], "remove": True}
    target = {"a/b": {"~key": 2}, "items": ["a", "x", "c", "d"], "added": {"ok": True}}
    operations = diff(source, target)
    check(isinstance(operations, list) and operations, "diff returned no operations")
    check(apply_patch(source, operations) == target, "forward patch did not produce target")
    check(source == {"a/b": {"~key": 1}, "items": ["a", "b", "c"], "remove": True}, "default patch mutated source")
    check(any("~1" in op.get("path", "") or "~0" in op.get("path", "") for op in operations), "JSON pointer escaping is missing")
    reverse = reverse_patch(source, operations)
    check(apply_patch(target, reverse) == source, "reverse patch did not restore source")
    check(apply_patch({"x": 1}, [{"op": "replace", "path": "", "value": [1, 2]}]) == [1, 2], "root replacement failed")
    expect_raises(PatchError, apply_patch, {}, [{"op": "remove", "path": "/missing"}])

def verify_task() -> bool:
    try:
        verify_json_diff_patch()
    except Exception as exc:
        print(f"FAIL [json_diff_patch]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [json_diff_patch]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
