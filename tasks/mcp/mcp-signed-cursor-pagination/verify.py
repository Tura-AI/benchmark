#!/usr/bin/env python3
"""Self-contained behavioral verifier for signed_cursor_pagination."""

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


def verify_signed_cursor_pagination() -> None:
    CursorCodec, paginate = load_exports("CursorCodec", "paginate")
    codec = CursorCodec("correct horse battery staple")
    token = codec.encode({"position": [10, 2], "kind": "record"})
    check(isinstance(token, str) and token, "encode must return a non-empty string")
    check(codec.decode(token) == {"position": [10, 2], "kind": "record"}, "cursor round-trip failed")
    tamper_at = len(token) // 2
    replacement = "A" if token[tamper_at] != "A" else "B"
    expect_raises(Exception, codec.decode, token[:tamper_at] + replacement + token[tamper_at + 1 :])
    expect_raises(Exception, CursorCodec("other-secret").decode, token)

    items = [
        {"score": 1, "id": 1},
        {"score": 1, "id": 2},
        {"score": 2, "id": 3},
        {"score": 3, "id": 4},
        {"score": 3, "id": 5},
    ]
    key = lambda item: (item["score"], item["id"])
    first, next_cursor = paginate(items, limit=2, cursor=None, key=key, codec=codec)
    second, next_cursor_2 = paginate(items, limit=2, cursor=next_cursor, key=key, codec=codec)
    third, final_cursor = paginate(items, limit=2, cursor=next_cursor_2, key=key, codec=codec)
    check([item["id"] for item in first + second + third] == [1, 2, 3, 4, 5], "pages duplicated, skipped, or reordered records")
    check(final_cursor is None, "the final page must not expose a continuation cursor")
    expect_raises(ValueError, paginate, items, limit=0, cursor=None, key=key, codec=codec)

def verify_task() -> bool:
    try:
        verify_signed_cursor_pagination()
    except Exception as exc:
        print(f"FAIL [signed_cursor_pagination]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [signed_cursor_pagination]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
