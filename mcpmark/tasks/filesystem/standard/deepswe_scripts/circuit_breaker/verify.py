#!/usr/bin/env python3
"""Self-contained behavioral verifier for circuit_breaker."""

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


def verify_circuit_breaker() -> None:
    CircuitBreaker, CircuitOpenError = load_exports("CircuitBreaker", "CircuitOpenError")
    now = [0.0]
    breaker = CircuitBreaker(2, 5, clock=lambda: now[0])
    def fail():
        raise ValueError("boom")
    expect_raises(ValueError, breaker.call, fail)
    expect_raises(ValueError, breaker.call, fail)
    check(breaker.snapshot()["state"].lower() == "open", "breaker did not open at threshold")
    expect_raises(CircuitOpenError, breaker.call, lambda: "blocked")
    now[0] = 5.0
    check(breaker.call(lambda: "ok") == "ok", "half-open probe did not run")
    check(breaker.snapshot()["state"].lower() == "closed", "successful probe did not close breaker")
    ignored = CircuitBreaker(1, 5, excluded_exceptions=(KeyError,), clock=lambda: now[0])
    expect_raises(KeyError, ignored.call, lambda: (_ for _ in ()).throw(KeyError("ignored")))
    check(ignored.snapshot()["state"].lower() == "closed", "excluded exception affected failure state")

    async def async_checks():
        async_breaker = CircuitBreaker(1, 1, clock=lambda: now[0])
        async def async_fail():
            raise RuntimeError("async")
        await expect_raises_async(RuntimeError, async_breaker.call_async(async_fail))
        await expect_raises_async(CircuitOpenError, async_breaker.call_async(lambda: "blocked"))
        async_breaker.reset()
        async def success():
            return 9
        check(await async_breaker.call_async(success) == 9, "async call success failed")
    asyncio.run(async_checks())

def verify_task() -> bool:
    try:
        verify_circuit_breaker()
    except Exception as exc:
        print(f"FAIL [circuit_breaker]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [circuit_breaker]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
