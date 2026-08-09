#!/usr/bin/env python3
"""Self-contained behavioral verifier for plugin_dependency_loader."""

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


def verify_plugin_dependency_loader() -> None:
    PluginLoader, PluginError = load_exports("PluginLoader", "PluginError")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        def make_plugin(name, version, dependencies, body):
            directory = root / name
            directory.mkdir()
            (directory / "plugin.json").write_text(json.dumps({
                "name": name,
                "version": version,
                "entrypoint": "plugin.py:register",
                "dependencies": dependencies,
            }), encoding="utf-8")
            (directory / "plugin.py").write_text(body, encoding="utf-8")
        make_plugin("core", "1.2.0", {}, "def register(registry):\n    registry.append('core')\n")
        make_plugin("feature", "2.0.0", {"core": ">=1.0.0"}, "def register(registry):\n    registry.append('feature')\n")
        loader = PluginLoader([root])
        discovered = loader.discover()
        check(set(discovered) == {"core", "feature"}, "plugin discovery failed")
        registry = []
        check(loader.load(registry) == ["core", "feature"], "dependency load order is wrong")
        check(registry == ["core", "feature"], "register functions did not run in dependency order")

        broken_root = root / "broken-set"
        broken_root.mkdir()
        directory = broken_root / "broken"
        directory.mkdir()
        (directory / "plugin.json").write_text(json.dumps({
            "name": "broken", "version": "1.0.0", "entrypoint": "plugin.py:register", "dependencies": {}
        }), encoding="utf-8")
        (directory / "plugin.py").write_text("def register(registry):\n    registry.append('broken')\n    raise RuntimeError('boom')\n", encoding="utf-8")
        rollback_registry = ["seed"]
        expect_raises(PluginError, PluginLoader([broken_root]).load, rollback_registry)
        check(rollback_registry == ["seed"], "failed load did not roll back registry changes")

        missing_root = root / "missing-set"
        missing_root.mkdir()
        directory = missing_root / "consumer"
        directory.mkdir()
        (directory / "plugin.json").write_text(json.dumps({
            "name": "consumer", "version": "1.0.0", "entrypoint": "plugin.py:register", "dependencies": {"absent": ">=1.0"}
        }), encoding="utf-8")
        (directory / "plugin.py").write_text("def register(registry): pass\n", encoding="utf-8")
        expect_raises(PluginError, PluginLoader([missing_root]).load, [])

def verify_task() -> bool:
    try:
        verify_plugin_dependency_loader()
    except Exception as exc:
        print(f"FAIL [plugin_dependency_loader]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [plugin_dependency_loader]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
