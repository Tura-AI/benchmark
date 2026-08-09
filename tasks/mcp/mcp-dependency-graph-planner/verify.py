#!/usr/bin/env python3
"""Self-contained behavioral verifier for dependency_graph_planner."""

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


def verify_dependency_graph_planner() -> None:
    DependencyGraph, DependencyCycleError, UnknownDependencyError = load_exports(
        "DependencyGraph", "DependencyCycleError", "UnknownDependencyError"
    )
    graph = DependencyGraph()
    graph.add("fetch")
    graph.add("parse", ["fetch"])
    graph.add("lint", ["fetch"])
    graph.add("publish", ["parse", "lint"])
    check(graph.order() == ["fetch", "parse", "lint", "publish"], "topological order is not stable")
    check(graph.layers() == [["fetch"], ["parse", "lint"], ["publish"]], "parallel layers are incorrect")
    check(graph.order(["publish"]) == ["fetch", "parse", "lint", "publish"], "subset planning omitted transitive dependencies")
    missing = DependencyGraph()
    missing.add("a", ["missing"])
    expect_raises(UnknownDependencyError, missing.order)
    cyclic = DependencyGraph()
    cyclic.add("a", ["c"])
    cyclic.add("b", ["a"])
    cyclic.add("c", ["b"])
    exc = expect_raises(DependencyCycleError, cyclic.order)
    check("a" in str(exc) and "b" in str(exc) and "c" in str(exc), "cycle error lacks the concrete cycle")

def verify_task() -> bool:
    try:
        verify_dependency_graph_planner()
    except Exception as exc:
        print(f"FAIL [dependency_graph_planner]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [dependency_graph_planner]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
