Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement a token-bucket rate limiter

## Context

The working directory contains the `relaykit` Python package. Provide a thread-safe token bucket with fractional refill and deterministic timing.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Use capacity, refill_rate, and an injectable monotonic clock; support fractional tokens without drift.
- consume(amount) returns immediately with a boolean and never permits a negative balance.
- time_until_available(amount) reports the exact wait without mutating observable capacity.
- Reject non-positive configuration and invalid token amounts, and expose a snapshot for diagnostics.
- Preserve this public call shape: `TokenBucket(capacity, refill_rate, *, clock=None); consume(amount=1) -> bool; time_until_available(amount=1) -> float; snapshot() -> dict`.

## Public API and compatibility

- Implement the feature in `relaykit/ratelimit.py`.
- Export `TokenBucket` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
