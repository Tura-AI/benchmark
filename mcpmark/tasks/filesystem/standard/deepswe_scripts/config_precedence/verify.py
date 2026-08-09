#!/usr/bin/env python3
"""Self-contained behavioral verifier for config_precedence."""

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


def verify_config_precedence() -> None:
    resolve_config, ConfigError = load_exports("resolve_config", "ConfigError")
    defaults = {
        "db": {"host": "localhost", "port": 5432},
        "debug": False,
        "ratio": 1.5,
        "tags": [],
        "optional": "present",
    }
    file_values = {"db": {"host": "file-host"}, "extra": {"enabled": True}}
    env = {
        "RELAY_DB__PORT": "6543",
        "RELAY_DEBUG": "true",
        "RELAY_RATIO": "2.25",
        "RELAY_TAGS": "blue,green",
        "RELAY_OPTIONAL": "null",
        "IGNORED": "value",
    }
    cli = {"db": {"host": "cli-host"}, "new_key": 9}
    originals = copy.deepcopy((defaults, file_values, env, cli))
    result = resolve_config(defaults, file_values, env, cli)
    check(result["db"] == {"host": "cli-host", "port": 6543}, "nested precedence is incorrect")
    check(result["debug"] is True and result["ratio"] == 2.25, "environment coercion failed")
    check(result["tags"] == ["blue", "green"] and result["optional"] is None, "list/null coercion failed")
    check(result["extra"]["enabled"] is True and result["new_key"] == 9, "unknown keys were lost")
    check((defaults, file_values, env, cli) == originals, "input mappings were mutated")
    expect_raises(ConfigError, resolve_config, defaults, None, {"RELAY_DEBUG": "maybe"})

def verify_task() -> bool:
    try:
        verify_config_precedence()
    except Exception as exc:
        print(f"FAIL [config_precedence]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [config_precedence]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
