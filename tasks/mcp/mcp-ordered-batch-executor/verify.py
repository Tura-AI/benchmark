#!/usr/bin/env python3
"""Self-contained behavioral verifier for ordered_batch_executor."""

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


def verify_ordered_batch_executor() -> None:
    batch_iter, batch_map, BatchResult = load_exports("batch_iter", "batch_map", "BatchResult")
    consumed = []
    def source():
        for value in range(5):
            consumed.append(value)
            yield value
    iterator = batch_iter(source(), 2)
    check(consumed == [], "batch_iter eagerly consumed its input")
    check(next(iterator) == (0, 1) and consumed == [0, 1], "first lazy batch is wrong")
    check(list(iterator) == [(2, 3), (4,)], "remaining batches are wrong")
    expect_raises(ValueError, batch_iter, [1], 0)

    async def checks():
        active = 0
        peak = 0
        async def process(batch):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01 if batch[0] == 0 else 0)
            active -= 1
            return [value * 2 for value in batch]
        results = await batch_map(process, list(range(7)), batch_size=3, concurrency=2)
        check(peak == 2, "batch concurrency limit was not used")
        check([result.value for result in results] == [0, 2, 4, 6, 8, 10, 12], "global order or values are wrong")
        check([result.index for result in results] == list(range(7)), "BatchResult indices are wrong")

        async def mismatch(batch):
            return []
        collected = await batch_map(mismatch, [1, 2], batch_size=2, fail_fast=False)
        check(len(collected) == 2 and all(result.error is not None for result in collected), "length mismatch was not represented per item")
        await expect_raises_async(Exception, batch_map(mismatch, [1, 2], batch_size=2, fail_fast=True))
        sync = await batch_map(lambda batch: [value + 1 for value in batch], [1, 2], batch_size=1)
        check([result.value for result in sync] == [2, 3], "sync batch function is unsupported")
    asyncio.run(checks())

def verify_task() -> bool:
    try:
        verify_ordered_batch_executor()
    except Exception as exc:
        print(f"FAIL [ordered_batch_executor]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [ordered_batch_executor]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
