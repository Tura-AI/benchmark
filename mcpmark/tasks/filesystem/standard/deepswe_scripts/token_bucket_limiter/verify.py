#!/usr/bin/env python3
"""Self-contained behavioral verifier for token_bucket_limiter."""

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


def verify_token_bucket_limiter() -> None:
    (TokenBucket,) = load_exports("TokenBucket")
    now = [0.0]
    bucket = TokenBucket(5, 2, clock=lambda: now[0])
    check(bucket.consume(5) is True and bucket.consume(0.1) is False, "capacity enforcement failed")
    check(math.isclose(bucket.time_until_available(1), 0.5, abs_tol=1e-9), "wait calculation is incorrect")
    before = bucket.snapshot()
    check(math.isclose(bucket.time_until_available(1), 0.5, abs_tol=1e-9), "wait calculation mutated state")
    check(bucket.snapshot()["tokens"] == before["tokens"], "snapshot changed after a read-only calculation")
    now[0] = 0.25
    check(bucket.consume(0.5) is True, "fractional refill failed")
    now[0] = 100
    check(bucket.snapshot()["tokens"] == 5, "refill exceeded capacity")
    for args in ((0, 1), (1, 0), (-1, 1)):
        expect_raises(ValueError, TokenBucket, *args)
    expect_raises(ValueError, bucket.consume, 0)

def verify_task() -> bool:
    try:
        verify_token_bucket_limiter()
    except Exception as exc:
        print(f"FAIL [token_bucket_limiter]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [token_bucket_limiter]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
