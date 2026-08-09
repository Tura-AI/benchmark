#!/usr/bin/env python3
"""Self-contained behavioral verifier for schema_migration_registry."""

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


def verify_schema_migration_registry() -> None:
    MigrationRegistry, MigrationError = load_exports("MigrationRegistry", "MigrationError")
    registry = MigrationRegistry()
    registry.register(
        1,
        lambda doc: {**doc, "full_name": doc.pop("name")},
        lambda doc: {**doc, "name": doc.pop("full_name")},
    )
    registry.register(
        2,
        lambda doc: {**doc, "active": True},
        lambda doc: {key: value for key, value in doc.items() if key != "active"},
    )
    source = {"_schema_version": 1, "name": "Ada"}
    original = copy.deepcopy(source)
    check(registry.plan(1, 3) == [(1, 2), (2, 3)], "forward plan is wrong")
    migrated = registry.migrate(source, 3)
    check(migrated == {"_schema_version": 3, "full_name": "Ada", "active": True}, "forward migration failed")
    check(source == original, "source document was mutated")
    downgraded = registry.migrate(migrated, 1)
    check(downgraded == source, "downgrade did not restore the document")
    check(registry.migrate(source, 1) == source, "no-op migration failed")
    expect_raises(MigrationError, registry.register, 1, lambda d: d, lambda d: d)
    expect_raises(MigrationError, registry.migrate, source, 5)

    failing = MigrationRegistry()
    failing.register(1, lambda doc: {**doc, "x": 1}, lambda doc: doc)
    def boom(doc):
        doc["corrupt"] = True
        raise RuntimeError("boom")
    failing.register(2, boom, lambda doc: doc)
    snapshot = copy.deepcopy(source)
    expect_raises(MigrationError, failing.migrate, source, 3)
    check(source == snapshot, "failed migration mutated the original")

def verify_task() -> bool:
    try:
        verify_schema_migration_registry()
    except Exception as exc:
        print(f"FAIL [schema_migration_registry]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [schema_migration_registry]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
