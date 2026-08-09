#!/usr/bin/env python3
"""Generate the self-contained DeepSWE-style MCPMark task pack.

The pack is intentionally original.  It follows DeepSWE's public methodology
(repository-level requests, fixed starting state, and behavior-based verifiers)
without copying gated benchmark instances or their reference solutions.
"""

from __future__ import annotations

import argparse
import ast
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CATEGORY = "deepswe_scripts"
TASK_ROOT = ROOT / "tasks" / "filesystem" / "standard" / CATEGORY
FIXTURE_ROOT = ROOT / "tasks" / "filesystem" / "fixtures" / CATEGORY
VERIFIER_SOURCE = Path(__file__).with_name("deepswe_verify.py")


TASKS = [
    {
        "id": "config_precedence",
        "title": "Add layered configuration resolution",
        "module": "config.py",
        "exports": ["resolve_config", "ConfigError"],
        "api": "resolve_config(defaults, file_values=None, env=None, cli=None, *, env_prefix='RELAY_') -> dict",
        "difficulty": "L3",
        "summary": "Implement deterministic merging of defaults, config-file values, environment variables, and CLI overrides.",
        "requirements": [
            "Apply precedence in the order defaults < file < environment < CLI without mutating any input mapping.",
            "Translate environment keys with the configured prefix into lower-case dotted keys, using double underscores as nesting separators.",
            "Coerce environment strings to the existing value type for booleans, integers, floats, lists, and null values; reject invalid coercions with ConfigError.",
            "Return a nested dictionary and preserve unknown file or CLI keys.",
        ],
    },
    {
        "id": "signed_cursor_pagination",
        "title": "Add signed keyset pagination cursors",
        "module": "cursor.py",
        "exports": ["CursorCodec", "paginate"],
        "api": "CursorCodec(secret).encode(payload), CursorCodec.decode(token), paginate(items, *, limit, cursor=None, key, codec) -> (page, next_cursor)",
        "difficulty": "L3",
        "summary": "Provide tamper-evident opaque cursors and stable keyset pagination for ordered records.",
        "requirements": [
            "CursorCodec(secret).encode(payload) must produce a URL-safe opaque string and decode() must recover the JSON-compatible payload.",
            "Reject malformed, modified, or wrong-secret cursors with CursorError.",
            "paginate(items, limit, cursor, key, codec) must return (page, next_cursor), never duplicate items, and use the keyset rather than an array offset.",
            "Support compound keys and deterministic ordering when multiple records share the first key component.",
        ],
    },
    {
        "id": "ttl_lru_cache",
        "title": "Implement a bounded TTL/LRU cache",
        "module": "cache.py",
        "exports": ["TTLCache"],
        "api": "TTLCache(max_size, ttl, clock=None); get(key, default=None), set(key, value, ttl=None), delete(key), clear(), get_or_set(key, factory), stats()",
        "difficulty": "L3",
        "summary": "Finish the in-memory cache with expiration, LRU eviction, statistics, and injectable time.",
        "requirements": [
            "Expire entries lazily using an injectable clock and never return stale values.",
            "Evict the least-recently-used live entry when max_size is exceeded; reads update recency.",
            "Support get, set, delete, clear, membership, len, and get_or_set without confusing stored None with a miss.",
            "Expose hit, miss, eviction, and expiration counters through stats().",
        ],
    },
    {
        "id": "priority_event_bus",
        "title": "Add a priority-aware event bus",
        "module": "events.py",
        "exports": ["EventBus", "EventDispatchError"],
        "api": "EventBus.subscribe(event, handler, *, priority=0, once=False) -> token; unsubscribe(token) -> bool; emit(event, payload=None) -> list; await emit_async(event, payload=None) -> list",
        "difficulty": "L3",
        "summary": "Implement deterministic synchronous and asynchronous event dispatch with safe subscription mutation.",
        "requirements": [
            "Subscriptions have priority and insertion order; higher priority handlers run first and ties remain stable.",
            "Support once-only subscriptions, token-based unsubscribe, wildcard subscriptions, and both sync and async handlers.",
            "Named handlers receive payload; wildcard '*' handlers receive (event_name, payload). emit returns handler results in dispatch order.",
            "Changes made while emitting affect only later emissions.",
            "Collect handler failures and raise one EventDispatchError after remaining handlers have run.",
        ],
    },
    {
        "id": "dependency_graph_planner",
        "title": "Implement dependency graph planning",
        "module": "graph.py",
        "exports": ["DependencyGraph", "DependencyCycleError", "UnknownDependencyError"],
        "api": "DependencyGraph.add(name, dependencies=()); validate(); order(selected=None) -> list[str]; layers(selected=None) -> list[list[str]]",
        "difficulty": "L3",
        "summary": "Add deterministic dependency ordering, parallel layers, subset closure, and actionable cycle errors.",
        "requirements": [
            "Register named nodes with dependencies and reject references to missing nodes during validation or planning.",
            "order() returns a stable topological order; layers() groups nodes that can run in parallel.",
            "Planning a selected subset automatically includes its transitive dependencies.",
            "Cycles raise DependencyCycleError containing a concrete closed cycle path.",
        ],
    },
    {
        "id": "retry_policy",
        "title": "Add deterministic retry policies",
        "module": "retry.py",
        "exports": ["RetryPolicy", "RetryExhausted"],
        "api": "RetryPolicy(max_attempts, *, delay=0, backoff=1, max_delay=None, jitter=0, exceptions=(Exception,), sleep=None, async_sleep=None, random=None); run(func, *args, retry_if=None, on_retry=None, **kwargs); await run_async(...) ",
        "difficulty": "L3",
        "summary": "Implement reusable sync and async retries with backoff, filtering, callbacks, and injectable sleeping.",
        "requirements": [
            "Support fixed and exponential delays, an optional maximum delay, and deterministic jitter through an injected random function.",
            "Retry only matching exceptions or retry_if decisions; immediately propagate non-retryable failures.",
            "Expose run() and run_async() with identical attempt semantics and an on_retry callback.",
            "Raise RetryExhausted with the final exception, attempt count, and elapsed delay after the configured attempts.",
        ],
    },
    {
        "id": "token_bucket_limiter",
        "title": "Implement a token-bucket rate limiter",
        "module": "ratelimit.py",
        "exports": ["TokenBucket"],
        "api": "TokenBucket(capacity, refill_rate, *, clock=None); consume(amount=1) -> bool; time_until_available(amount=1) -> float; snapshot() -> dict",
        "difficulty": "L3",
        "summary": "Provide a thread-safe token bucket with fractional refill and deterministic timing.",
        "requirements": [
            "Use capacity, refill_rate, and an injectable monotonic clock; support fractional tokens without drift.",
            "consume(amount) returns immediately with a boolean and never permits a negative balance.",
            "time_until_available(amount) reports the exact wait without mutating observable capacity.",
            "Reject non-positive configuration and invalid token amounts, and expose a snapshot for diagnostics.",
        ],
    },
    {
        "id": "recursive_secret_redaction",
        "title": "Add recursive structured-data redaction",
        "module": "redaction.py",
        "exports": ["Redactor"],
        "api": "Redactor(keys=None, patterns=None, replacement='[REDACTED]'); redact(value) -> deep-copied value",
        "difficulty": "L3",
        "summary": "Implement non-mutating secret redaction across nested objects and free-form strings.",
        "requirements": [
            "Redact mapping values whose keys match configured names case-insensitively, including nested dictionaries and sequences.",
            "Redact bearer tokens, common API-key assignments, and URL credentials inside strings while preserving surrounding text.",
            "Handle dataclasses and cycles without infinite recursion, and preserve ordinary scalar types.",
            "Allow a custom replacement and additional key or regex rules.",
        ],
    },
    {
        "id": "atomic_json_store",
        "title": "Implement an atomic JSON document store",
        "module": "store.py",
        "exports": ["AtomicJSONStore", "StoreConflictError", "StoreCorruptionError"],
        "api": "AtomicJSONStore(path); read() -> dict; write(document, expected_revision=None) -> dict; update(callback, expected_revision=None) -> dict",
        "difficulty": "L4",
        "summary": "Add crash-safe JSON persistence with optimistic revisions, backups, and transactional updates.",
        "requirements": [
            "write() must use a same-directory temporary file, flush it, and atomically replace the target without leaving temporary files.",
            "Every document carries a monotonically increasing integer `_revision`; expected_revision mismatches raise StoreConflictError.",
            "update(callback) performs a locked read-modify-write operation and returns an isolated copy.",
            "Detect malformed primary data, recover from a valid backup when possible, and otherwise raise StoreCorruptionError.",
        ],
    },
    {
        "id": "async_worker_pool",
        "title": "Add a cancellation-safe async worker pool",
        "module": "worker.py",
        "exports": ["map_concurrent", "WorkResult"],
        "api": "await map_concurrent(func, items, *, limit, fail_fast=False) -> list[WorkResult]; WorkResult has index, item, value, error",
        "difficulty": "L4",
        "summary": "Implement bounded asynchronous mapping with ordered results and explicit failure semantics.",
        "requirements": [
            "Never run more than limit operations simultaneously and preserve input order in returned WorkResult objects.",
            "In collect mode, record per-item values or exceptions and continue processing all work.",
            "In fail-fast mode, cancel outstanding work, await cleanup, and re-raise the first failure.",
            "Caller cancellation must propagate and leave no orphan tasks; support synchronous or asynchronous worker functions.",
        ],
    },
    {
        "id": "plugin_dependency_loader",
        "title": "Implement plugin discovery and dependency loading",
        "module": "plugins.py",
        "exports": ["PluginLoader", "PluginError"],
        "api": "PluginLoader(paths).discover() -> dict; load(registry) -> list[str]",
        "difficulty": "L4",
        "summary": "Load Python plugins from manifests with dependency ordering, version checks, and rollback.",
        "requirements": [
            "Discover plugin.json manifests with name, semantic version, `file.py:function` entrypoint, and a dependency mapping of plugin names to constraints; reject duplicates and malformed fields.",
            "Resolve dependencies in stable topological order and enforce simple >=, ==, and < version constraints.",
            "Import each entrypoint and call register(registry); if any plugin fails, undo registrations from that load operation.",
            "Report missing dependencies and cycles through PluginError with actionable plugin names.",
        ],
    },
    {
        "id": "schema_migration_registry",
        "title": "Add reversible schema migrations",
        "module": "migrations.py",
        "exports": ["MigrationRegistry", "MigrationError"],
        "api": "MigrationRegistry.register(from_version, up, down); plan(current, target) -> list[tuple[int, int]]; migrate(document, target) -> dict",
        "difficulty": "L4",
        "summary": "Implement deterministic forward and backward migration of versioned dictionary documents.",
        "requirements": [
            "Register exactly one up and down migration for consecutive integer versions and reject gaps or duplicates.",
            "migrate(document, target) must apply every required step on a deep copy and update the integer `_schema_version` after each successful step.",
            "Support downgrades, no-op migrations, and rollback to the original document when a step raises.",
            "Expose plan(current, target) and reject unreachable or invalid versions with MigrationError.",
        ],
    },
    {
        "id": "json_diff_patch",
        "title": "Add JSON diff, patch, and reversal",
        "module": "jsonpatch.py",
        "exports": ["diff", "apply_patch", "reverse_patch", "PatchError"],
        "api": "diff(source, target) -> list[dict]; apply_patch(document, operations, *, in_place=False); reverse_patch(source, operations) -> list[dict]",
        "difficulty": "L4",
        "summary": "Implement deterministic RFC-6901-style paths and reversible add/remove/replace operations.",
        "requirements": [
            "diff(source, target) returns deterministic add, remove, and replace operations for nested dictionaries and lists.",
            "Escape ~ and / in path segments and address list positions correctly as earlier operations change lengths.",
            "apply_patch works on a deep copy by default, validates paths and indices, and supports root replacement.",
            "reverse_patch(source, operations) produces operations that restore the exact source after the forward patch.",
        ],
    },
    {
        "id": "cron_schedule_engine",
        "title": "Implement a five-field cron schedule engine",
        "module": "schedule.py",
        "exports": ["CronSchedule", "CronSyntaxError"],
        "api": "CronSchedule(expression); matches(datetime) -> bool; next(after, count=1) -> list[datetime]",
        "difficulty": "L4",
        "summary": "Parse and evaluate deterministic five-field cron expressions without third-party packages.",
        "requirements": [
            "Support *, ranges, lists, and step expressions for minute, hour, day-of-month, month, and weekday.",
            "Accept month and weekday names case-insensitively and normalize Sunday values 0 and 7.",
            "matches(datetime) follows standard cron day-of-month/day-of-week OR semantics when both are restricted.",
            "next(after, count) returns strictly later matching datetimes, preserves timezone information, and rejects impossible syntax.",
        ],
    },
    {
        "id": "targeted_feature_flags",
        "title": "Add deterministic targeted feature flags",
        "module": "flags.py",
        "exports": ["FeatureFlagEngine", "FlagConfigError"],
        "api": "FeatureFlagEngine(definitions, *, salt=''); evaluate(flag_key, context, *, identity=None) -> Evaluation(value, reason, rule_index)",
        "difficulty": "L3",
        "summary": "Evaluate boolean and multivariate flags using ordered targeting rules and stable percentage rollout.",
        "requirements": [
            "Definitions use `default`, optional ordered `rules` entries (`when` plus `value`), and optional `rollout` entries (`value` plus percentage). Conditions support eq, in, gt/gte/lt/lte and all/any groups over dotted context attributes.",
            "The first matching rule wins; otherwise use percentage rollout or the declared default.",
            "Percentage assignment is stable across processes using a cryptographic hash of flag key, identity, and salt.",
            "Validate rollout totals and variants, return an evaluation reason, and never mutate flag definitions or context.",
        ],
    },
    {
        "id": "circuit_breaker",
        "title": "Implement a concurrent circuit breaker",
        "module": "circuit.py",
        "exports": ["CircuitBreaker", "CircuitOpenError"],
        "api": "CircuitBreaker(failure_threshold, reset_timeout, *, half_open_max_calls=1, excluded_exceptions=(), clock=None); call(func, *args, **kwargs); await call_async(...); reset(); snapshot()",
        "difficulty": "L4",
        "summary": "Add closed, open, and half-open state transitions with deterministic timing and concurrency control.",
        "requirements": [
            "Open after the configured consecutive failure threshold and reject calls while the reset timeout has not elapsed.",
            "Allow only the configured number of half-open probes; success closes the breaker and failure reopens it.",
            "Ignore excluded exception types, expose state and counters, and support explicit reset().",
            "Provide matching call() and call_async() behavior using an injectable monotonic clock.",
        ],
    },
    {
        "id": "ordered_batch_executor",
        "title": "Add an ordered batch executor",
        "module": "batch.py",
        "exports": ["batch_iter", "batch_map", "BatchResult"],
        "api": "batch_iter(iterable, size) -> iterator[tuple]; await batch_map(func, items, *, batch_size, concurrency=1, fail_fast=False) -> list[BatchResult]",
        "difficulty": "L3",
        "summary": "Implement lazy batching plus bounded async batch execution with per-item accounting.",
        "requirements": [
            "batch_iter accepts any iterable, validates size, is lazy, and emits a final partial tuple.",
            "batch_map invokes a sync or async batch function with bounded concurrency while preserving global input order.",
            "A batch function may return values or per-item exceptions; normalize both into BatchResult entries.",
            "Each BatchResult exposes index, item, value, and error fields.",
            "Detect result-length mismatches, support collect and fail-fast modes, and clean up outstanding work on cancellation.",
        ],
    },
    {
        "id": "safe_query_language",
        "title": "Implement a safe structured query language",
        "module": "query.py",
        "exports": ["compile_query", "QuerySyntaxError"],
        "api": "compile_query(expression) -> callable(record) -> bool",
        "difficulty": "L4",
        "summary": "Parse a small query language into a reusable predicate without eval or arbitrary code execution.",
        "requirements": [
            "Support dotted fields, strings, numbers, booleans, null, comparisons, in/not in, contains, and parentheses.",
            "Support case-insensitive AND, OR, and NOT with conventional precedence.",
            "Missing fields evaluate safely rather than raising, and numeric comparisons never coerce unrelated strings.",
            "Reject trailing tokens, function calls, attribute execution, and malformed literals with QuerySyntaxError.",
        ],
    },
    {
        "id": "hash_chained_audit_log",
        "title": "Add a tamper-evident audit log",
        "module": "audit.py",
        "exports": ["AuditLog", "AuditIntegrityError"],
        "api": "AuditLog(path, *, clock=None); append(actor, action, data) -> dict; verify() -> bool; iter_records(verify=True) -> iterator[dict]",
        "difficulty": "L4",
        "summary": "Persist canonical JSON-lines audit events linked by cryptographic hashes.",
        "requirements": [
            "append(actor, action, data) writes one canonical JSON record containing sequence, timestamp, previous hash, and record hash.",
            "Use an injectable clock, flush and fsync writes, and continue a valid existing chain after reopening.",
            "verify() detects edited, removed, reordered, duplicated, or malformed records and raises AuditIntegrityError with the failing line.",
            "iter_records verifies by default and returns defensive copies of decoded records.",
        ],
    },
    {
        "id": "checkpoint_pipeline",
        "title": "Add resumable checkpointed pipelines",
        "module": "pipeline.py",
        "exports": ["CheckpointPipeline", "PipelineError"],
        "api": "CheckpointPipeline(checkpoint_path); add_step(name, run, rollback=None); run(context=None, *, resume=False) -> dict",
        "difficulty": "L4",
        "summary": "Implement named multi-step pipelines with atomic checkpoints, resume validation, and rollback hooks.",
        "requirements": [
            "Register uniquely named steps with run(context) and optional rollback(context) callables, then execute them in order.",
            "After every successful step, atomically persist the completed names, JSON-compatible context, and a deterministic pipeline signature derived from the ordered step names.",
            "resume=True skips completed steps only when the signature matches; malformed or incompatible checkpoints raise PipelineError.",
            "On failure, invoke rollback hooks for steps completed during the current invocation in reverse order and retain a resumable checkpoint.",
        ],
    },
]


MODULE_STUBS = {
    task["module"]: f'''"""{task["summary"]}"""\n\n# Implemented by the {task["id"]} benchmark task.\n'''
    for task in TASKS
}


def write_text(path: Path, content: str, *, force: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        return
    path.write_text(content, encoding="utf-8", newline="\n")


def generate_fixture(*, force: bool) -> None:
    write_text(
        FIXTURE_ROOT / "pyproject.toml",
        """[project]\nname = \"relaykit\"\nversion = \"0.1.0\"\nrequires-python = \">=3.11\"\n\n[build-system]\nrequires = [\"setuptools>=68\"]\nbuild-backend = \"setuptools.build_meta\"\n""",
        force=force,
    )
    write_text(
        FIXTURE_ROOT / "README.md",
        """# RelayKit\n\nRelayKit is a dependency-free Python utility library used as the fixed starting\nrepository for the `deepswe_scripts` MCPMark category.  Each benchmark task\nimplements one production-oriented subsystem and exports its documented public\nAPI from `relaykit/__init__.py`.\n""",
        force=force,
    )
    write_text(
        FIXTURE_ROOT / "relaykit" / "__init__.py",
        '"""Public API for RelayKit."""\n\n__all__: list[str] = []\n',
        force=force,
    )
    for module, content in MODULE_STUBS.items():
        write_text(FIXTURE_ROOT / "relaykit" / module, content, force=force)


def description_for(task: dict) -> str:
    requirements = "\n".join(f"- {item}" for item in task["requirements"])
    requirements += f"\n- Preserve this public call shape: `{task['api']}`."
    exports = ", ".join(f"`{name}`" for name in task["exports"])
    return f"""Please use the FileSystem MCP tools to complete this repository-level engineering task.\n\n# {task['title']}\n\n## Context\n\nThe working directory contains the `relaykit` Python package. {task['summary']}\nThe current module is an intentionally incomplete starting point. Implement a\nproduction-quality solution using only the Python standard library.\n\n## Required behavior\n\n{requirements}\n\n## Public API and compatibility\n\n- Implement the feature in `relaykit/{task['module']}`.\n- Export {exports} from `relaykit/__init__.py` so callers can import them directly from `relaykit`.\n- Keep the package dependency-free and compatible with Python 3.11+.\n- Preserve existing public behavior outside this feature.\n- Do not add task-specific hard-coded outputs; the implementation must work for arbitrary valid inputs.\n\nYou may reorganize internal code when useful. The result will be evaluated by\nbehavioral tests, including edge cases and repeated calls, rather than by an\nexpected patch or exact implementation structure.\n"""


def meta_for(task: dict) -> dict:
    return {
        "task_id": task["id"],
        "task_name": task["title"],
        "category_id": CATEGORY,
        "category_name": "DeepSWE-style Scripts",
        "description": task["summary"],
        "author": "Tura AI",
        "created_at": "2026-08-09",
        "difficulty": task["difficulty"],
        "tags": ["software-engineering", "repository-level", "behavioral-verifier", *task.get("tags", [])],
        "mcp": ["filesystem"],
        "meta_data": {
            "stateType": "repository",
            "stateContent": f"relaykit/{task['module']}",
            "stateLocalFixture": "tasks/filesystem/fixtures/deepswe_scripts",
            "referenceMethodology": "https://github.com/datacurve-ai/deep-swe",
            "originalTask": True,
        },
    }


def standalone_verifier(task_id: str) -> str:
    """Build a task-local verifier with no imports from the shared scripts dir."""
    source = VERIFIER_SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source)
    verifier_nodes = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name.startswith("verify_")
        and node.name != "verify_task"
    ]
    target_name = f"verify_{task_id}"
    target = next((node for node in verifier_nodes if node.name == target_name), None)
    if target is None:
        raise ValueError(f"missing verifier implementation: {target_name}")

    # The source prefix contains imports plus the generic assertion/loading
    # helpers. The selected function contains only this task's behavior tests.
    prefix_lines = source.splitlines(keepends=True)[: verifier_nodes[0].lineno - 1]
    function_source = ast.get_source_segment(source, target)
    if function_source is None:
        raise ValueError(f"could not extract verifier implementation: {target_name}")

    runner = f'''\n\ndef verify_task() -> bool:
    try:
        {target_name}()
    except Exception as exc:
        print(f"FAIL [{task_id}]: {{type(exc).__name__}}: {{exc}}", file=sys.stderr)
        return False
    print("PASS [{task_id}]")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if verify_task() else 1)
'''
    header = (
        f'#!/usr/bin/env python3\n'
        f'"""Self-contained behavioral verifier for {task_id}."""\n\n'
    )
    # Drop the source module's shebang and module docstring. The remaining
    # future import must stay directly below this generated module docstring.
    reusable_prefix = "".join(prefix_lines)
    reusable_prefix = reusable_prefix.split('from __future__ import annotations', 1)[1]
    reusable_prefix = 'from __future__ import annotations' + reusable_prefix
    return header + reusable_prefix + function_source.rstrip() + runner


def generate_tasks(*, force: bool) -> None:
    for task in TASKS:
        directory = TASK_ROOT / task["id"]
        write_text(directory / "description.md", description_for(task), force=force)
        write_text(
            directory / "meta.json",
            json.dumps(meta_for(task), indent=2, ensure_ascii=False) + "\n",
            force=force,
        )
        write_text(directory / "verify.py", standalone_verifier(task["id"]), force=force)

    write_text(
        TASK_ROOT / "README.md",
        f"""# DeepSWE-style scripts task pack\n\nThis category contains {len(TASKS)} original repository-level engineering tasks.\nIt follows the public DeepSWE methodology but does not copy gated benchmark\ninstances, hidden tests, or reference solutions. The fixed RelayKit starting\nrepository is stored in `tasks/filesystem/fixtures/{CATEGORY}` and installed by\nthe filesystem state manager before a run. Every task directory contains its\nown complete `verify.py`; verification does not import a shared test runner.\n\nRegenerate the pack with:\n\n```bash\npython tasks/filesystem/scripts/generate_deepswe_tasks.py --force\n```\n""",
        force=force,
    )


def validate() -> list[str]:
    errors: list[str] = []
    ids = [task["id"] for task in TASKS]
    if len(ids) != 20 or len(set(ids)) != 20:
        errors.append("TASKS must contain exactly 20 unique task IDs")
    for task in TASKS:
        directory = TASK_ROOT / task["id"]
        for name in ("description.md", "meta.json", "verify.py"):
            if not (directory / name).is_file():
                errors.append(f"missing {task['id']}/{name}")
        verifier_path = directory / "verify.py"
        if verifier_path.is_file():
            verifier = verifier_path.read_text(encoding="utf-8")
            if "deepswe_verify" in verifier:
                errors.append(f"{task['id']}/verify.py imports the shared verifier")
            if f"def verify_{task['id']}" not in verifier:
                errors.append(f"{task['id']}/verify.py lacks its task-local tests")
        if not (FIXTURE_ROOT / "relaykit" / task["module"]).is_file():
            errors.append(f"missing fixture module {task['module']}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite generated files")
    parser.add_argument("--check", action="store_true", help="validate existing generated files")
    parser.add_argument("--clean", action="store_true", help="remove generated task and fixture directories first")
    args = parser.parse_args()

    if args.clean:
        shutil.rmtree(TASK_ROOT, ignore_errors=True)
        shutil.rmtree(FIXTURE_ROOT, ignore_errors=True)
    if not args.check:
        generate_fixture(force=args.force)
        generate_tasks(force=args.force)
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"Validated {len(TASKS)} DeepSWE-style MCPMark tasks in {TASK_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
