#!/usr/bin/env python3
"""Self-contained behavioral verifier for retry_policy."""

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


def verify_retry_policy() -> None:
    RetryPolicy, RetryExhausted = load_exports("RetryPolicy", "RetryExhausted")
    sleeps: list[float] = []
    attempts = [0]
    callbacks = []
    policy = RetryPolicy(4, delay=1, backoff=2, max_delay=3, jitter=0, sleep=sleeps.append)
    def flaky():
        attempts[0] += 1
        if attempts[0] < 3:
            raise ValueError(f"fail-{attempts[0]}")
        return "ok"
    check(policy.run(flaky, on_retry=lambda *args: callbacks.append(args)) == "ok", "sync retry did not return success")
    check(attempts[0] == 3 and sleeps == [1, 2] and len(callbacks) == 2, "sync attempt/backoff semantics are wrong")
    expect_raises(TypeError, policy.run, lambda: (_ for _ in ()).throw(TypeError("stop")), retry_if=lambda exc: False)

    exhausted = RetryPolicy(2, delay=0, sleep=lambda _: None)
    exc = expect_raises(RetryExhausted, exhausted.run, lambda: (_ for _ in ()).throw(ValueError("last")))
    check(getattr(exc, "attempts", None) == 2, "RetryExhausted lacks the attempt count")
    check(isinstance(getattr(exc, "last_exception", getattr(exc, "exception", None)), ValueError), "RetryExhausted lacks the final exception")

    async def async_checks():
        async_sleeps = []
        count = [0]
        async def fake_sleep(value):
            async_sleeps.append(value)
        async def flaky_async():
            count[0] += 1
            if count[0] == 1:
                raise OSError("retry")
            return 5
        async_policy = RetryPolicy(2, delay=0.5, async_sleep=fake_sleep)
        check(await async_policy.run_async(flaky_async) == 5, "async retry failed")
        check(async_sleeps == [0.5], "async retry delay is incorrect")
    asyncio.run(async_checks())

def verify_task() -> bool:
    try:
        verify_retry_policy()
    except Exception as exc:
        print(f"FAIL [retry_policy]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [retry_policy]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
