#!/usr/bin/env python3
"""Self-contained behavioral verifier for ttl_lru_cache."""

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


def verify_ttl_lru_cache() -> None:
    (TTLCache,) = load_exports("TTLCache")
    now = [100.0]
    cache = TTLCache(2, 10, clock=lambda: now[0])
    cache.set("a", 1)
    cache.set("b", None)
    check(cache.get("a") == 1, "cache read failed")
    check("b" in cache and cache.get("b", "missing") is None, "stored None was treated as a miss")
    cache.set("c", 3)
    check("a" in cache and "b" not in cache and "c" in cache, "LRU eviction did not honor read recency")
    now[0] += 11
    check(cache.get("a", "expired") == "expired" and len(cache) == 0, "expired entries remain visible")
    calls = []
    check(cache.get_or_set("x", lambda: calls.append(1) or 7) == 7, "get_or_set did not create a value")
    check(cache.get_or_set("x", lambda: calls.append(2) or 8) == 7 and calls == [1], "get_or_set reran its factory on a hit")
    stats = cache.stats()
    for key in ("hits", "misses", "evictions", "expirations"):
        check(key in stats and isinstance(stats[key], int), f"stats is missing integer {key}")
    cache.clear()
    check(len(cache) == 0, "clear failed")

def verify_task() -> bool:
    try:
        verify_ttl_lru_cache()
    except Exception as exc:
        print(f"FAIL [ttl_lru_cache]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [ttl_lru_cache]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
