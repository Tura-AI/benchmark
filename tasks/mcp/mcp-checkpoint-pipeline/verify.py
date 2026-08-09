#!/usr/bin/env python3
"""Self-contained behavioral verifier for checkpoint_pipeline."""

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


def verify_checkpoint_pipeline() -> None:
    CheckpointPipeline, PipelineError = load_exports("CheckpointPipeline", "PipelineError")
    with tempfile.TemporaryDirectory() as td:
        checkpoint = Path(td) / "checkpoint.json"
        calls = []
        pipeline = CheckpointPipeline(checkpoint)
        pipeline.add_step("one", lambda context: {**context, "one": context.get("one", 0) + 1})
        pipeline.add_step("two", lambda context: {**context, "two": context["one"] + 1})
        result = pipeline.run({"seed": True})
        check(result == {"seed": True, "one": 1, "two": 2}, "pipeline context flow failed")
        saved = json.loads(checkpoint.read_text(encoding="utf-8"))
        check(saved["completed"] == ["one", "two"] and saved["context"] == result, "checkpoint contents are wrong")
        check(not list(Path(td).glob("*.tmp")), "atomic checkpoint left temporary files")

        resumed = CheckpointPipeline(checkpoint)
        resumed.add_step("one", lambda context: (_ for _ in ()).throw(RuntimeError("must skip")))
        resumed.add_step("two", lambda context: (_ for _ in ()).throw(RuntimeError("must skip")))
        check(resumed.run(resume=True) == result, "resume reran completed steps")

        rollback_calls = []
        failing_checkpoint = Path(td) / "failing.json"
        failing = CheckpointPipeline(failing_checkpoint)
        failing.add_step("a", lambda context: {**context, "a": 1}, lambda context: rollback_calls.append("a"))
        failing.add_step("b", lambda context: {**context, "b": 1}, lambda context: rollback_calls.append("b"))
        failing.add_step("c", lambda context: (_ for _ in ()).throw(ValueError("boom")))
        expect_raises(Exception, failing.run, {})
        check(rollback_calls == ["b", "a"], "rollback hooks did not run in reverse order")
        check(failing_checkpoint.is_file(), "failed pipeline did not retain a checkpoint")

        incompatible = CheckpointPipeline(checkpoint)
        incompatible.add_step("different", lambda context: context)
        expect_raises(PipelineError, incompatible.run, None, resume=True)
        checkpoint.write_text("{broken", encoding="utf-8")
        expect_raises(PipelineError, resumed.run, None, resume=True)

def verify_task() -> bool:
    try:
        verify_checkpoint_pipeline()
    except Exception as exc:
        print(f"FAIL [checkpoint_pipeline]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print("PASS [checkpoint_pipeline]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
