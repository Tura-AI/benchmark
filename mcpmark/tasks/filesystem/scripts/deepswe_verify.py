#!/usr/bin/env python3
"""Behavior-based verifier suite for the original DeepSWE-style task pack."""

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


def verify_config_precedence() -> None:
    resolve_config, ConfigError = load_exports("resolve_config", "ConfigError")
    defaults = {
        "db": {"host": "localhost", "port": 5432},
        "debug": False,
        "ratio": 1.5,
        "tags": [],
        "optional": "present",
    }
    file_values = {"db": {"host": "file-host"}, "extra": {"enabled": True}}
    env = {
        "RELAY_DB__PORT": "6543",
        "RELAY_DEBUG": "true",
        "RELAY_RATIO": "2.25",
        "RELAY_TAGS": "blue,green",
        "RELAY_OPTIONAL": "null",
        "IGNORED": "value",
    }
    cli = {"db": {"host": "cli-host"}, "new_key": 9}
    originals = copy.deepcopy((defaults, file_values, env, cli))
    result = resolve_config(defaults, file_values, env, cli)
    check(result["db"] == {"host": "cli-host", "port": 6543}, "nested precedence is incorrect")
    check(result["debug"] is True and result["ratio"] == 2.25, "environment coercion failed")
    check(result["tags"] == ["blue", "green"] and result["optional"] is None, "list/null coercion failed")
    check(result["extra"]["enabled"] is True and result["new_key"] == 9, "unknown keys were lost")
    check((defaults, file_values, env, cli) == originals, "input mappings were mutated")
    expect_raises(ConfigError, resolve_config, defaults, None, {"RELAY_DEBUG": "maybe"})


def verify_signed_cursor_pagination() -> None:
    CursorCodec, paginate = load_exports("CursorCodec", "paginate")
    codec = CursorCodec("correct horse battery staple")
    token = codec.encode({"position": [10, 2], "kind": "record"})
    check(isinstance(token, str) and token, "encode must return a non-empty string")
    check(codec.decode(token) == {"position": [10, 2], "kind": "record"}, "cursor round-trip failed")
    tamper_at = len(token) // 2
    replacement = "A" if token[tamper_at] != "A" else "B"
    expect_raises(Exception, codec.decode, token[:tamper_at] + replacement + token[tamper_at + 1 :])
    expect_raises(Exception, CursorCodec("other-secret").decode, token)

    items = [
        {"score": 1, "id": 1},
        {"score": 1, "id": 2},
        {"score": 2, "id": 3},
        {"score": 3, "id": 4},
        {"score": 3, "id": 5},
    ]
    key = lambda item: (item["score"], item["id"])
    first, next_cursor = paginate(items, limit=2, cursor=None, key=key, codec=codec)
    second, next_cursor_2 = paginate(items, limit=2, cursor=next_cursor, key=key, codec=codec)
    third, final_cursor = paginate(items, limit=2, cursor=next_cursor_2, key=key, codec=codec)
    check([item["id"] for item in first + second + third] == [1, 2, 3, 4, 5], "pages duplicated, skipped, or reordered records")
    check(final_cursor is None, "the final page must not expose a continuation cursor")
    expect_raises(ValueError, paginate, items, limit=0, cursor=None, key=key, codec=codec)


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


def verify_recursive_secret_redaction() -> None:
    (Redactor,) = load_exports("Redactor")
    @dataclasses.dataclass
    class Credentials:
        user: str
        password: str
    source = {
        "Password": "secret",
        "nested": [{"api_key": "abc", "note": "Authorization: Bearer token-123"}],
        "url": "https://alice:hunter2@example.com/path",
        "credentials": Credentials("alice", "pw"),
        "count": 3,
    }
    original = copy.deepcopy(source)
    result = Redactor().redact(source)
    check(source == original, "redaction mutated the source")
    check(result["Password"] == "[REDACTED]", "case-insensitive key redaction failed")
    check(result["nested"][0]["api_key"] == "[REDACTED]", "nested secret key was not redacted")
    check("token-123" not in result["nested"][0]["note"], "bearer token leaked")
    check("hunter2" not in result["url"] and "alice" not in result["url"], "URL credentials leaked")
    check(result["credentials"].password == "[REDACTED]", "dataclass secret was not redacted")
    check(result["count"] == 3, "ordinary scalar was changed")
    custom = Redactor(keys=["private"], replacement="***").redact({"private": "x"})
    check(custom == {"private": "***"}, "custom key/replacement failed")
    cyclic = {}
    cyclic["self"] = cyclic
    redacted_cycle = Redactor().redact(cyclic)
    check(redacted_cycle["self"] is redacted_cycle, "cycles were not preserved safely")


def verify_atomic_json_store() -> None:
    AtomicJSONStore, StoreConflictError, StoreCorruptionError = load_exports(
        "AtomicJSONStore", "StoreConflictError", "StoreCorruptionError"
    )
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "state.json"
        store = AtomicJSONStore(path)
        first = store.write({"name": "first"})
        check(first["_revision"] == 1 and store.read() == first, "initial revision/write failed")
        second = store.write({"name": "second"}, expected_revision=1)
        check(second["_revision"] == 2, "revision did not increase")
        expect_raises(StoreConflictError, store.write, {"name": "bad"}, expected_revision=1)
        updated = store.update(lambda document: {**document, "count": document.get("count", 0) + 1}, expected_revision=2)
        check(updated["_revision"] == 3 and updated["count"] == 1, "transactional update failed")
        check(not list(Path(td).glob("*.tmp")), "temporary files were left behind")
        path.write_text("{broken", encoding="utf-8")
        recovered = store.read()
        check(isinstance(recovered, dict) and recovered.get("_revision", 0) >= 1, "valid backup was not used for recovery")
        path.write_text("{broken", encoding="utf-8")
        for backup in Path(td).glob("*.bak"):
            backup.write_text("broken", encoding="utf-8")
        expect_raises(StoreCorruptionError, store.read)


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


def verify_plugin_dependency_loader() -> None:
    PluginLoader, PluginError = load_exports("PluginLoader", "PluginError")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        def make_plugin(name, version, dependencies, body):
            directory = root / name
            directory.mkdir()
            (directory / "plugin.json").write_text(json.dumps({
                "name": name,
                "version": version,
                "entrypoint": "plugin.py:register",
                "dependencies": dependencies,
            }), encoding="utf-8")
            (directory / "plugin.py").write_text(body, encoding="utf-8")
        make_plugin("core", "1.2.0", {}, "def register(registry):\n    registry.append('core')\n")
        make_plugin("feature", "2.0.0", {"core": ">=1.0.0"}, "def register(registry):\n    registry.append('feature')\n")
        loader = PluginLoader([root])
        discovered = loader.discover()
        check(set(discovered) == {"core", "feature"}, "plugin discovery failed")
        registry = []
        check(loader.load(registry) == ["core", "feature"], "dependency load order is wrong")
        check(registry == ["core", "feature"], "register functions did not run in dependency order")

        broken_root = root / "broken-set"
        broken_root.mkdir()
        directory = broken_root / "broken"
        directory.mkdir()
        (directory / "plugin.json").write_text(json.dumps({
            "name": "broken", "version": "1.0.0", "entrypoint": "plugin.py:register", "dependencies": {}
        }), encoding="utf-8")
        (directory / "plugin.py").write_text("def register(registry):\n    registry.append('broken')\n    raise RuntimeError('boom')\n", encoding="utf-8")
        rollback_registry = ["seed"]
        expect_raises(PluginError, PluginLoader([broken_root]).load, rollback_registry)
        check(rollback_registry == ["seed"], "failed load did not roll back registry changes")

        missing_root = root / "missing-set"
        missing_root.mkdir()
        directory = missing_root / "consumer"
        directory.mkdir()
        (directory / "plugin.json").write_text(json.dumps({
            "name": "consumer", "version": "1.0.0", "entrypoint": "plugin.py:register", "dependencies": {"absent": ">=1.0"}
        }), encoding="utf-8")
        (directory / "plugin.py").write_text("def register(registry): pass\n", encoding="utf-8")
        expect_raises(PluginError, PluginLoader([missing_root]).load, [])


def verify_schema_migration_registry() -> None:
    MigrationRegistry, MigrationError = load_exports("MigrationRegistry", "MigrationError")
    registry = MigrationRegistry()
    registry.register(
        1,
        lambda doc: {**doc, "full_name": doc.pop("name")},
        lambda doc: {**doc, "name": doc.pop("full_name")},
    )
    registry.register(
        2,
        lambda doc: {**doc, "active": True},
        lambda doc: {key: value for key, value in doc.items() if key != "active"},
    )
    source = {"_schema_version": 1, "name": "Ada"}
    original = copy.deepcopy(source)
    check(registry.plan(1, 3) == [(1, 2), (2, 3)], "forward plan is wrong")
    migrated = registry.migrate(source, 3)
    check(migrated == {"_schema_version": 3, "full_name": "Ada", "active": True}, "forward migration failed")
    check(source == original, "source document was mutated")
    downgraded = registry.migrate(migrated, 1)
    check(downgraded == source, "downgrade did not restore the document")
    check(registry.migrate(source, 1) == source, "no-op migration failed")
    expect_raises(MigrationError, registry.register, 1, lambda d: d, lambda d: d)
    expect_raises(MigrationError, registry.migrate, source, 5)

    failing = MigrationRegistry()
    failing.register(1, lambda doc: {**doc, "x": 1}, lambda doc: doc)
    def boom(doc):
        doc["corrupt"] = True
        raise RuntimeError("boom")
    failing.register(2, boom, lambda doc: doc)
    snapshot = copy.deepcopy(source)
    expect_raises(MigrationError, failing.migrate, source, 3)
    check(source == snapshot, "failed migration mutated the original")


def verify_json_diff_patch() -> None:
    diff, apply_patch, reverse_patch, PatchError = load_exports("diff", "apply_patch", "reverse_patch", "PatchError")
    source = {"a/b": {"~key": 1}, "items": ["a", "b", "c"], "remove": True}
    target = {"a/b": {"~key": 2}, "items": ["a", "x", "c", "d"], "added": {"ok": True}}
    operations = diff(source, target)
    check(isinstance(operations, list) and operations, "diff returned no operations")
    check(apply_patch(source, operations) == target, "forward patch did not produce target")
    check(source == {"a/b": {"~key": 1}, "items": ["a", "b", "c"], "remove": True}, "default patch mutated source")
    check(any("~1" in op.get("path", "") or "~0" in op.get("path", "") for op in operations), "JSON pointer escaping is missing")
    reverse = reverse_patch(source, operations)
    check(apply_patch(target, reverse) == source, "reverse patch did not restore source")
    check(apply_patch({"x": 1}, [{"op": "replace", "path": "", "value": [1, 2]}]) == [1, 2], "root replacement failed")
    expect_raises(PatchError, apply_patch, {}, [{"op": "remove", "path": "/missing"}])


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


def verify_targeted_feature_flags() -> None:
    FeatureFlagEngine, FlagConfigError = load_exports("FeatureFlagEngine", "FlagConfigError")
    definitions = {
        "new-ui": {
            "default": False,
            "rules": [
                {"when": {"country": {"in": ["FR", "DE"]}, "age": {"gte": 18}}, "value": True},
                {"when": {"plan": {"eq": "blocked"}}, "value": False},
            ],
        },
        "theme": {
            "default": "classic",
            "rollout": [
                {"value": "blue", "percentage": 40},
                {"value": "green", "percentage": 60},
            ],
        },
    }
    original = copy.deepcopy(definitions)
    engine = FeatureFlagEngine(definitions, salt="stable")
    matched = engine.evaluate("new-ui", {"country": "FR", "age": 20, "plan": "pro"}, identity="u1")
    check(matched.value is True and matched.rule_index == 0, "ordered targeting rule failed")
    defaulted = engine.evaluate("new-ui", {"country": "US", "age": 20}, identity="u2")
    check(defaulted.value is False and "default" in defaulted.reason.lower(), "default evaluation/reason failed")
    first = engine.evaluate("theme", {}, identity="same-user").value
    check(all(FeatureFlagEngine(definitions, salt="stable").evaluate("theme", {}, identity="same-user").value == first for _ in range(5)), "rollout assignment is not stable")
    check(first in {"blue", "green"}, "rollout returned an undeclared variant")
    check(definitions == original, "definitions were mutated")
    expect_raises(FlagConfigError, FeatureFlagEngine, {"bad": {"default": "x", "rollout": [{"value": "x", "percentage": 80}]}})
    expect_raises(Exception, engine.evaluate, "missing", {}, identity="u")


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


def verify_safe_query_language() -> None:
    compile_query, QuerySyntaxError = load_exports("compile_query", "QuerySyntaxError")
    query = compile_query("user.age >= 18 AND (country in ['FR', 'DE'] OR plan == 'pro') AND NOT disabled")
    check(query({"user": {"age": 20}, "country": "FR", "disabled": False}), "valid record did not match")
    check(query({"user": {"age": 20}, "country": "US", "plan": "pro", "disabled": False}), "OR branch did not match")
    check(not query({"user": {"age": 17}, "country": "FR", "disabled": False}), "numeric comparison failed")
    check(not query({"country": "FR", "disabled": False}), "missing field did not evaluate safely")
    contains = compile_query("tags contains 'urgent' AND deleted == null")
    check(contains({"tags": ["urgent", "ops"], "deleted": None}), "contains/null failed")
    check(compile_query("name not in ['root', 'admin']")({"name": "user"}), "not in failed")
    check(not compile_query("score > 10")({"score": "100"}), "numeric comparison coerced a string")
    for expression in ("x == 1 trailing", "__import__('os')", "user.run()", "(x == 1"):
        expect_raises(QuerySyntaxError, compile_query, expression)


def verify_hash_chained_audit_log() -> None:
    AuditLog, AuditIntegrityError = load_exports("AuditLog", "AuditIntegrityError")
    ticks = iter([
        datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc),
        datetime(2026, 1, 1, 0, 2, tzinfo=timezone.utc),
    ])
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "audit.jsonl"
        log = AuditLog(path, clock=lambda: next(ticks))
        first = log.append("alice", "create", {"id": 1})
        second = log.append("bob", "update", {"id": 1, "value": "x"})
        check(first["sequence"] == 1 and second["sequence"] == 2, "sequence numbers are wrong")
        check(second["previous_hash"] == first["hash"], "hash chain linkage is wrong")
        check(log.verify() is True, "valid chain did not verify")
        records = list(log.iter_records())
        records[0]["data"]["id"] = 999
        check(list(log.iter_records())[0]["data"]["id"] == 1, "iter_records leaked mutable internal state")
        reopened = AuditLog(path, clock=lambda: next(ticks))
        third = reopened.append("carol", "delete", {"id": 1})
        check(third["sequence"] == 3 and reopened.verify(), "reopened log did not continue the chain")
        lines = path.read_text(encoding="utf-8").splitlines()
        tampered = json.loads(lines[1])
        tampered["action"] = "tampered"
        lines[1] = json.dumps(tampered, sort_keys=True, separators=(",", ":"))
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        exc = expect_raises(AuditIntegrityError, reopened.verify)
        check("2" in str(exc), "integrity error does not identify the failing line")


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


VERIFIERS = {
    "config_precedence": verify_config_precedence,
    "signed_cursor_pagination": verify_signed_cursor_pagination,
    "ttl_lru_cache": verify_ttl_lru_cache,
    "priority_event_bus": verify_priority_event_bus,
    "dependency_graph_planner": verify_dependency_graph_planner,
    "retry_policy": verify_retry_policy,
    "token_bucket_limiter": verify_token_bucket_limiter,
    "recursive_secret_redaction": verify_recursive_secret_redaction,
    "atomic_json_store": verify_atomic_json_store,
    "async_worker_pool": verify_async_worker_pool,
    "plugin_dependency_loader": verify_plugin_dependency_loader,
    "schema_migration_registry": verify_schema_migration_registry,
    "json_diff_patch": verify_json_diff_patch,
    "cron_schedule_engine": verify_cron_schedule_engine,
    "targeted_feature_flags": verify_targeted_feature_flags,
    "circuit_breaker": verify_circuit_breaker,
    "ordered_batch_executor": verify_ordered_batch_executor,
    "safe_query_language": verify_safe_query_language,
    "hash_chained_audit_log": verify_hash_chained_audit_log,
    "checkpoint_pipeline": verify_checkpoint_pipeline,
}


def verify_task(task_id: str) -> bool:
    verifier = VERIFIERS.get(task_id)
    if verifier is None:
        print(f"FAIL: unknown task ID {task_id}", file=sys.stderr)
        return False
    try:
        verifier()
    except Exception as exc:
        print(f"FAIL [{task_id}]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    print(f"PASS [{task_id}]")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: deepswe_verify.py TASK_ID", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(0 if verify_task(sys.argv[1]) else 1)
