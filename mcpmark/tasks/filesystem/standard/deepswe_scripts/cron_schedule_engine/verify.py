#!/usr/bin/env python3
"""Self-contained behavioral verifier for cron_schedule_engine."""

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


def verify_cron_schedule_engine() -> None:
    CronSchedule, CronSyntaxError = load_exports("CronSchedule", "CronSyntaxError")
    schedule = CronSchedule("*/15 9-10 * JAN,MAR MON-FRI")
    check(schedule.matches(datetime(2026, 1, 5, 9, 30)), "valid named/range/step expression did not match")
    check(not schedule.matches(datetime(2026, 1, 4, 9, 30)), "weekday restriction was ignored")
    sunday = CronSchedule("0 0 * * 7")
    check(sunday.matches(datetime(2026, 1, 4, 0, 0)), "Sunday value 7 was not normalized")
    dom_or_dow = CronSchedule("0 0 13 * MON")
    check(dom_or_dow.matches(datetime(2026, 2, 13, 0, 0)), "day-of-month branch of OR semantics failed")
    check(dom_or_dow.matches(datetime(2026, 2, 16, 0, 0)), "day-of-week branch of OR semantics failed")
    start = datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc)
    runs = schedule.next(start, 3)
    check(runs == [
        datetime(2026, 1, 5, 9, 15, tzinfo=timezone.utc),
        datetime(2026, 1, 5, 9, 30, tzinfo=timezone.utc),
        datetime(2026, 1, 5, 9, 45, tzinfo=timezone.utc),
    ], "next() is not strictly later or timezone-preserving")
    for expression in ("* * *", "61 * * * *", "*/0 * * * *", "* * * FOO *"):
        expect_raises(CronSyntaxError, CronSchedule, expression)

def verify_task() -> bool:
    try:
        verify_cron_schedule_engine()
    except Exception as exc:
        print(f"FAIL [cron_schedule_engine]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [cron_schedule_engine]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
