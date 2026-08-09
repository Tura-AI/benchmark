#!/usr/bin/env python3
"""Self-contained behavioral verifier for hash_chained_audit_log."""

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


def verify_hash_chained_audit_log() -> None:
    AuditLog, AuditIntegrityError = load_exports("AuditLog", "AuditIntegrityError")
    ticks = iter([
        datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc),
        datetime(2026, 1, 1, 0, 2, tzinfo=timezone.utc),
    ])
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "audit.jsonl"
        log = AuditLog(path, clock=lambda: next(ticks))
        first = log.append("alice", "create", {"id": 1})
        second = log.append("bob", "update", {"id": 1, "value": "x"})
        check(first["sequence"] == 1 and second["sequence"] == 2, "sequence numbers are wrong")
        check(second["previous_hash"] == first["hash"], "hash chain linkage is wrong")
        check(log.verify() is True, "valid chain did not verify")
        records = list(log.iter_records())
        records[0]["data"]["id"] = 999
        check(list(log.iter_records())[0]["data"]["id"] == 1, "iter_records leaked mutable internal state")
        reopened = AuditLog(path, clock=lambda: next(ticks))
        third = reopened.append("carol", "delete", {"id": 1})
        check(third["sequence"] == 3 and reopened.verify(), "reopened log did not continue the chain")
        lines = path.read_text(encoding="utf-8").splitlines()
        tampered = json.loads(lines[1])
        tampered["action"] = "tampered"
        lines[1] = json.dumps(tampered, sort_keys=True, separators=(",", ":"))
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        exc = expect_raises(AuditIntegrityError, reopened.verify)
        check("2" in str(exc), "integrity error does not identify the failing line")

def verify_task() -> bool:
    try:
        verify_hash_chained_audit_log()
    except Exception as exc:
        print(f"FAIL [hash_chained_audit_log]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [hash_chained_audit_log]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
