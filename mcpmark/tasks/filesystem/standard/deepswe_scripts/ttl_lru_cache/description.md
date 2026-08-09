Please use the FileSystem MCP tools to complete this repository-level engineering task.

# Implement a bounded TTL/LRU cache

## Context

The working directory contains the `relaykit` Python package. Finish the in-memory cache with expiration, LRU eviction, statistics, and injectable time.
The current module is an intentionally incomplete starting point. Implement a
production-quality solution using only the Python standard library.

## Required behavior

- Expire entries lazily using an injectable clock and never return stale values.
- Evict the least-recently-used live entry when max_size is exceeded; reads update recency.
- Support get, set, delete, clear, membership, len, and get_or_set without confusing stored None with a miss.
- Expose hit, miss, eviction, and expiration counters through stats().
- Preserve this public call shape: `TTLCache(max_size, ttl, clock=None); get(key, default=None), set(key, value, ttl=None), delete(key), clear(), get_or_set(key, factory), stats()`.

## Public API and compatibility

- Implement the feature in `relaykit/cache.py`.
- Export `TTLCache` from `relaykit/__init__.py` so callers can import them directly from `relaykit`.
- Keep the package dependency-free and compatible with Python 3.11+.
- Preserve existing public behavior outside this feature.
- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.

You may reorganize internal code when useful. The result will be evaluated by
behavioral tests, including edge cases and repeated calls, rather than by an
expected patch or exact implementation structure.
