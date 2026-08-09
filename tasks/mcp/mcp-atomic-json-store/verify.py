#!/usr/bin/env python3
"""Self-contained behavioral verifier for atomic_json_store."""

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


def verify_atomic_json_store() -> None:
    AtomicJSONStore, StoreConflictError, StoreCorruptionError = load_exports(
        "AtomicJSONStore", "StoreConflictError", "StoreCorruptionError"
    )
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "state.json"
        store = AtomicJSONStore(path)
        first = store.write({"name": "first"})
        check(first["_revision"] == 1 and store.read() == first, "initial revision/write failed")
        second = store.write({"name": "second"}, expected_revision=1)
        check(second["_revision"] == 2, "revision did not increase")
        expect_raises(StoreConflictError, store.write, {"name": "bad"}, expected_revision=1)
        updated = store.update(lambda document: {**document, "count": document.get("count", 0) + 1}, expected_revision=2)
        check(updated["_revision"] == 3 and updated["count"] == 1, "transactional update failed")
        check(not list(Path(td).glob("*.tmp")), "temporary files were left behind")
        path.write_text("{broken", encoding="utf-8")
        recovered = store.read()
        check(isinstance(recovered, dict) and recovered.get("_revision", 0) >= 1, "valid backup was not used for recovery")
        path.write_text("{broken", encoding="utf-8")
        for backup in Path(td).glob("*.bak"):
            backup.write_text("broken", encoding="utf-8")
        expect_raises(StoreCorruptionError, store.read)

def verify_task() -> bool:
    try:
        verify_atomic_json_store()
    except Exception as exc:
        print(f"FAIL [atomic_json_store]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [atomic_json_store]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
