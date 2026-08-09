#!/usr/bin/env python3
"""Self-contained behavioral verifier for async_worker_pool."""

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


def verify_async_worker_pool() -> None:
    map_concurrent, WorkResult = load_exports("map_concurrent", "WorkResult")
    async def checks():
        active = 0
        peak = 0
        lock = asyncio.Lock()
        async def worker(value):
            nonlocal active, peak
            async with lock:
                active += 1
                peak = max(peak, active)
            await asyncio.sleep(0.01 * (4 - value))
            async with lock:
                active -= 1
            return value * 10
        results = await map_concurrent(worker, [1, 2, 3], limit=2)
        check(peak == 2, "concurrency limit was not enforced")
        check([result.index for result in results] == [0, 1, 2], "result order/index is wrong")
        check([result.value for result in results] == [10, 20, 30], "values were not preserved in input order")
        check(all(result.error is None for result in results), "successful work has errors")

        async def sometimes(value):
            if value == 2:
                raise ValueError("bad")
            return value
        collected = await map_concurrent(sometimes, [1, 2, 3], limit=3, fail_fast=False)
        check(isinstance(collected[1].error, ValueError) and collected[2].value == 3, "collect mode did not preserve failures and later work")
        await expect_raises_async(ValueError, map_concurrent(sometimes, [1, 2, 3], limit=2, fail_fast=True))
        sync_results = await map_concurrent(lambda value: value + 1, [1, 2], limit=1)
        check([r.value for r in sync_results] == [2, 3], "synchronous workers are unsupported")
    asyncio.run(checks())

def verify_task() -> bool:
    try:
        verify_async_worker_pool()
    except Exception as exc:
        print(f"FAIL [async_worker_pool]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [async_worker_pool]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
