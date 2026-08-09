#!/usr/bin/env python3
"""Self-contained behavioral verifier for priority_event_bus."""

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


def verify_priority_event_bus() -> None:
    EventBus, EventDispatchError = load_exports("EventBus", "EventDispatchError")
    bus = EventBus()
    calls: list[str] = []
    low = bus.subscribe("build", lambda payload: calls.append(f"low:{payload}") or "low", priority=0)
    bus.subscribe("build", lambda payload: calls.append(f"high:{payload}") or "high", priority=10)
    bus.subscribe("build", lambda payload: calls.append("once") or "once", priority=5, once=True)
    bus.subscribe("*", lambda event, payload: calls.append(f"wild:{event}:{payload}") or "wild")
    result = bus.emit("build", "v1")
    check(calls == ["high:v1", "once", "low:v1", "wild:build:v1"], "priority, once, or wildcard ordering is incorrect")
    check(result == ["high", "once", "low", "wild"], "emit did not preserve handler results")
    calls.clear()
    bus.emit("build", "v2")
    check("once" not in calls, "once-only handler ran twice")
    check(bus.unsubscribe(low) is True and bus.unsubscribe(low) is False, "unsubscribe must report token removal")

    mutation_bus = EventBus()
    mutation_calls = []
    def first(payload):
        mutation_calls.append("first")
        mutation_bus.subscribe("x", lambda payload: mutation_calls.append("late"))
    mutation_bus.subscribe("x", first)
    mutation_bus.emit("x")
    check(mutation_calls == ["first"], "subscription mutation affected the active emission")
    mutation_bus.emit("x")
    check(mutation_calls[-2:] == ["first", "late"], "new subscription was not visible later")

    async def async_checks():
        async_bus = EventBus()
        async def handler(payload):
            await asyncio.sleep(0)
            return payload * 2
        async_bus.subscribe("n", handler)
        check(await async_bus.emit_async("n", 4) == [8], "async handler dispatch failed")
    asyncio.run(async_checks())

    error_bus = EventBus()
    completed = []
    error_bus.subscribe("x", lambda payload: (_ for _ in ()).throw(ValueError("boom")), priority=5)
    error_bus.subscribe("x", lambda payload: completed.append(True))
    expect_raises(EventDispatchError, error_bus.emit, "x")
    check(completed == [True], "dispatch stopped after the first handler error")

def verify_task() -> bool:
    try:
        verify_priority_event_bus()
    except Exception as exc:
        print(f"FAIL [priority_event_bus]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [priority_event_bus]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
