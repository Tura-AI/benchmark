#!/usr/bin/env python3
"""Validate Tura benchmark contracts against the schemas in this directory."""

from __future__ import annotations

import argparse
import json
import sys
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource


SCHEMA_DIR = Path(__file__).resolve().parent
DEFAULT_BENCHMARK_DATA = SCHEMA_DIR.parent


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def schema_registry() -> Registry:
    registry = Registry()
    for path in SCHEMA_DIR.glob("*.schema.json"):
        schema = load_json(path)
        resource = Resource.from_contents(schema)
        registry = registry.with_resource(path.as_uri(), resource)
        if schema.get("$id"):
            registry = registry.with_resource(schema["$id"], resource)
    return registry


@lru_cache(maxsize=None)
def validator(schema_name: str) -> Draft202012Validator:
    schema_path = SCHEMA_DIR / schema_name
    schema = load_json(schema_path)
    return Draft202012Validator(schema, registry=schema_registry(), format_checker=FormatChecker())


def check_schema_files(errors: list[str]) -> None:
    for path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        try:
            Draft202012Validator.check_schema(load_json(path))
        except Exception as exc:  # noqa: BLE001 - report every schema error together
            errors.append(f"schema {path.name}: {exc}")


def validate_json(path: Path, schema_name: str, errors: list[str]) -> None:
    try:
        instance = load_json(path)
        found = sorted(validator(schema_name).iter_errors(instance), key=lambda item: list(item.path))
        for error in found:
            location = ".".join(str(part) for part in error.absolute_path) or "$"
            errors.append(f"{path} [{location}]: {error.message}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{path}: {exc}")


def validate_jsonl(path: Path, schema_name: str, errors: list[str]) -> None:
    schema_validator = validator(schema_name)
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                instance = json.loads(line)
                for error in schema_validator.iter_errors(instance):
                    location = ".".join(str(part) for part in error.absolute_path) or "$"
                    errors.append(f"{path}:{line_number} [{location}]: {error.message}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{path}: {exc}")


def validate_normalized(root: Path, errors: list[str]) -> dict[str, int]:
    patterns = {
        "task.schema.json": "tasks/*/*/task.json",
        "task-harness.schema.json": "tasks/*/*/harness.json",
        "run-summary.schema.json": "results/*/*/*/*/*/metadata/summary.json",
        "cli-metadata.schema.json": "results/*/*/*/*/*/metadata/contracts/cli-metadata.json",
        "harness-report.schema.json": "results/*/*/*/*/*/metadata/contracts/harness-report.json",
        "task-report.schema.json": "results/*/*/*/*/*/metadata/contracts/task-report.json",
        "benchmark-web-run.schema.json": "results/*/*/*/*/*/metadata/contracts/benchmark-web-run.json",
        "contract-manifest.schema.json": "results/*/*/*/*/*/metadata/contracts/contract-manifest.json",
        "changed-workspace.schema.json": "results/debug/*/*/*/*/metadata/workspace-recovery.json",
        "design-task.schema.json": "results/design/*/design-task.json",
        "design-run.schema.json": "results/design/*/*/*/metadata/contracts/design-run.json",
    }
    counts: dict[str, int] = {}
    for schema_name, pattern in patterns.items():
        paths = sorted(root.glob(pattern))
        counts[schema_name] = len(paths)
        for path in paths:
            validate_json(path, schema_name, errors)

    workspace_paths = sorted(root.glob("results/debug/*/*/*/*/workspace/.benchmark-workspace.json"))
    counts["changed workspace manifests"] = len(workspace_paths)
    for path in workspace_paths:
        validate_json(path, "changed-workspace.schema.json", errors)

    deepswe_patterns = {
        "DeepSWE task contracts": ("task.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-*/*/task.json"),
        "DeepSWE harness contracts": ("task-harness.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-*/*/harness.json"),
        "DeepSWE batch manifests": ("deepswe-official-batch.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-high-r*/manifest.json"),
        "DeepSWE medium batch manifests": ("deepswe-official-batch.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-medium-r*/manifest.json"),
        "DeepSWE official subset manifests": ("deepswe-official-subset.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-mini-swe-agent-*-r*/manifest.json"),
        "DeepSWE official subset audits": ("deepswe-official-subset-audit.schema.json", "results/debug/deepswe-v1.1-gpt56-sol-mini-swe-agent-*-audit.json"),
        "DeepSWE local batch manifests": ("deepswe-local-batch.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-local-r*/manifest.json"),
        "DeepSWE Codex High batch manifests": ("deepswe-local-batch.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-codex-cli-high-r*/manifest.json"),
        "DeepSWE Tura pair High batch manifests": ("deepswe-local-batch.schema.json", "results/debug/report-deepswe-v1.1-gpt56-sol-tura-pair-high-r*/manifest.json"),
        "DeepSWE import audits": ("deepswe-import-audit.schema.json", "results/debug/deepswe-v1.1-gpt56-sol-import-audit.json"),
        "DeepSWE local audits": ("deepswe-local-audit.schema.json", "results/debug/deepswe-v1.1-gpt56-sol-local-audit.json"),
        "DeepSWE Codex High audits": ("deepswe-codex-high-audit.schema.json", "results/debug/deepswe-v1.1-gpt56-sol-codex-cli-high-audit.json"),
        "DeepSWE Tura pair High audits": ("deepswe-tura-pair-audit.schema.json", "results/debug/deepswe-v1.1-gpt56-sol-tura-pair-high-audit.json"),
    }
    for label, (schema_name, pattern) in deepswe_patterns.items():
        paths = sorted(root.glob(pattern))
        counts[label] = len(paths)
        for path in paths:
            validate_json(path, schema_name, errors)

    round_paths = sorted(root.glob("results/*/*/*/*/*/metadata/contracts/agent-rounds.jsonl"))
    counts["agent-round.schema.json"] = len(round_paths)
    for path in round_paths:
        validate_jsonl(path, "agent-round.schema.json", errors)
    return counts


def validate_task_declarations(tura_root: Path, errors: list[str]) -> int:
    paths = sorted(tura_root.glob("tasks/*/*/benchmark.task.json"))
    for path in paths:
        validate_json(path, "task-declaration.schema.json", errors)
    return len(paths)


def bounded(paths: list[Path], limit: int) -> list[Path]:
    if limit <= 0 or len(paths) <= limit:
        return paths
    head = limit // 2
    return paths[:head] + paths[-(limit - head):]


def validate_website(root: Path, errors: list[str], limit: int) -> dict[str, int]:
    run_paths = sorted((root / "public/benchmark-data/runs").glob("*.json"))
    repo_paths = sorted((root / "public/benchmark-data/repos").glob("*.json"))
    targets = {
        "website-index.schema.json": [
            root / "src/data/benchmark/benchmarkCatalog.generated.json",
            root / "public/benchmark-data/index.json",
        ],
        "website-run-detail.schema.json": bounded(run_paths, limit),
        "repo-browser.schema.json": bounded(repo_paths, limit),
    }
    counts: dict[str, int] = {}
    for schema_name, paths in targets.items():
        existing = [path for path in paths if path.exists()]
        counts[schema_name] = len(existing)
        for path in existing:
            validate_json(path, schema_name, errors)
    return counts


def validate_raw(root: Path, errors: list[str]) -> dict[str, int]:
    summaries = sorted((root / "raw").glob("**/agent-summary.json"))
    stdout = sorted((root / "raw").glob("**/stdout.jsonl")) + sorted((root / "raw").glob("**/agent.stdout.jsonl"))
    provider = sorted((root / "raw").glob("**/provider-calls-full.jsonl"))
    for path in summaries:
        validate_json(path, "raw-agent-summary.schema.json", errors)
    for path in stdout:
        validate_jsonl(path, "raw-agent-event.schema.json", errors)
    for path in provider:
        validate_jsonl(path, "provider-call.schema.json", errors)
    return {"raw summaries": len(summaries), "raw stdout JSONL": len(stdout), "raw provider JSONL": len(provider)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark-data", type=Path, default=DEFAULT_BENCHMARK_DATA)
    parser.add_argument("--website-root", type=Path)
    parser.add_argument("--tura-root", type=Path, default=SCHEMA_DIR.parent)
    parser.add_argument("--include-raw", action="store_true")
    parser.add_argument("--website-limit", type=int, default=12, help="Validate this many deterministic run/repo website shards; 0 validates all")
    parser.add_argument("--max-errors", type=int, default=100)
    args = parser.parse_args()

    errors: list[str] = []
    check_schema_files(errors)
    counts = validate_normalized(args.benchmark_data.resolve(), errors)
    counts["task declarations"] = validate_task_declarations(args.tura_root.resolve(), errors)
    if args.website_root:
        counts.update(validate_website(args.website_root.resolve(), errors, args.website_limit))
    if args.include_raw:
        counts.update(validate_raw(args.benchmark_data.resolve(), errors))

    print(json.dumps({"validated": counts, "errors": len(errors)}, indent=2))
    for error in errors[: args.max_errors]:
        print(f"ERROR: {error}", file=sys.stderr)
    if len(errors) > args.max_errors:
        print(f"ERROR: {len(errors) - args.max_errors} additional errors omitted", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
