#!/usr/bin/env python3
"""Self-contained behavioral verifier for recursive_secret_redaction."""

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


def verify_recursive_secret_redaction() -> None:
    (Redactor,) = load_exports("Redactor")
    @dataclasses.dataclass
    class Credentials:
        user: str
        password: str
    source = {
        "Password": "secret",
        "nested": [{"api_key": "abc", "note": "Authorization: Bearer token-123"}],
        "url": "https://alice:hunter2@example.com/path",
        "credentials": Credentials("alice", "pw"),
        "count": 3,
    }
    original = copy.deepcopy(source)
    result = Redactor().redact(source)
    check(source == original, "redaction mutated the source")
    check(result["Password"] == "[REDACTED]", "case-insensitive key redaction failed")
    check(result["nested"][0]["api_key"] == "[REDACTED]", "nested secret key was not redacted")
    check("token-123" not in result["nested"][0]["note"], "bearer token leaked")
    check("hunter2" not in result["url"] and "alice" not in result["url"], "URL credentials leaked")
    check(result["credentials"].password == "[REDACTED]", "dataclass secret was not redacted")
    check(result["count"] == 3, "ordinary scalar was changed")
    custom = Redactor(keys=["private"], replacement="***").redact({"private": "x"})
    check(custom == {"private": "***"}, "custom key/replacement failed")
    cyclic = {}
    cyclic["self"] = cyclic
    redacted_cycle = Redactor().redact(cyclic)
    check(redacted_cycle["self"] is redacted_cycle, "cycles were not preserved safely")

def verify_task() -> bool:
    try:
        verify_recursive_secret_redaction()
    except Exception as exc:
        print(f"FAIL [recursive_secret_redaction]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [recursive_secret_redaction]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
