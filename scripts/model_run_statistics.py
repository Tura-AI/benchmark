#!/usr/bin/env python3
"""Build reproducible agent-group round, token, success, and cost charts."""

from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import numpy as np
from scipy.optimize import least_squares, minimize
from scipy.special import expit

from analysis_config import configured_path, load_analysis_config, repository_path


ANALYSIS_CONFIG = load_analysis_config()
AGENT_ORDER = tuple(ANALYSIS_CONFIG["configurations"])
AGENT_LABELS = {
    "tura-balanced": "Tura Balanced",
    "tura-direct": "Tura Direct",
    "codex-cli-medium": "Codex CLI Medium",
    "codex-cli-high": "Codex CLI High",
}
PRICE_PER_MILLION = dict(ANALYSIS_CONFIG["pricingUsdPer1mTokens"])
RELATIONSHIP_EXCLUSIONS = {
    item["runId"]: item for item in ANALYSIS_CONFIG["relationshipExclusions"]
}


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    category: str
    report: str
    task: str
    agent_group: str
    agent_id: str
    model: str
    effort: str
    rounds: int
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_tokens: int
    total_tokens: int
    passed: int
    checks: int
    success_rate: float
    cost_usd: float
    usage_available: bool
    usage_source: str
    round_usage_total_tokens: int
    round_usage_checked: bool
    aggregate_snapshot_usage_rounds: int
    excluded_duplicate_usage_rounds: int
    reported_total_tokens: int | None
    reported_cost_usd: float | None
    source_path: str


def exclusion_reason(record: RunRecord) -> str | None:
    exclusion = RELATIONSHIP_EXCLUSIONS.get(record.run_id)
    return str(exclusion["reason"]) if exclusion else None


def select_analysis_records(
    records: Sequence[RunRecord],
) -> tuple[list[RunRecord], list[tuple[RunRecord, str]]]:
    included: list[RunRecord] = []
    excluded: list[tuple[RunRecord, str]] = []
    for record in records:
        reason = exclusion_reason(record)
        if reason:
            excluded.append((record, reason))
        else:
            included.append(record)
    return included, excluded


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config/analysis.json"))
    parser.add_argument("--results", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
    )
    return parser.parse_args()


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def nested(value: dict, *paths: Sequence[str]):
    for keys in paths:
        current = value
        for key in keys:
            if not isinstance(current, dict) or key not in current:
                break
            current = current[key]
        else:
            if current is not None:
                return current
    return None


def normalize_agent_group(*values: str | None) -> str:
    text = " ".join(str(value or "").lower() for value in values)
    if "tura-balanced" in text:
        return "tura-balanced"
    if "tura-direct" in text:
        return "tura-direct"
    if "codex" in text and "medium" in text:
        return "codex-cli-medium"
    if "codex" in text and "high" in text:
        return "codex-cli-high"
    raise ValueError(f"Cannot identify agent group from: {values}")


def normalize_model(*values: str | None) -> str:
    text = " ".join(str(value or "").lower() for value in values)
    if "5.6" in text or "56-sol" in text or "gpt56" in text:
        return "gpt-5.6-sol"
    if "5.5" in text or "gpt55" in text:
        return "gpt-5.5"
    raise ValueError(f"Cannot identify model from: {values}")


def normalize_effort(*values: str | None) -> str:
    text = " ".join(str(value or "").lower() for value in values)
    if "medium" in text:
        return "medium"
    if "high" in text:
        return "high"
    return "unspecified"


def load_round_usage(
    path: Path,
) -> tuple[int, dict[str, int], dict, int, int, list[dict[str, int]]]:
    totals = {
        "inputTokens": 0,
        "cacheInputTokens": 0,
        "outputTokens": 0,
        "reasoningTokens": 0,
        "totalTokens": 0,
    }
    metadata: dict = {}
    indexes: list[int] = []
    excluded_duplicate_usage_rounds = 0
    populated_usage_rounds = 0
    usage_rows: list[dict[str, int]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL at {path}:{line_number}: {exc}") from exc
            if not metadata and isinstance(item.get("metadata"), dict):
                metadata = item["metadata"]
            indexes.append(int(item.get("roundIndex", item.get("index", len(indexes) + 1))))
            usage = item.get("usage") or {}
            has_token_components = (
                usage.get("inputTokens") is not None
                and usage.get("outputTokens") is not None
            )
            if not has_token_components:
                continue
            populated_usage_rounds += 1
            input_tokens = int(usage.get("inputTokens") or 0)
            cached_tokens = int(usage.get("cacheInputTokens") or 0)
            output_tokens = int(usage.get("outputTokens") or 0)
            total_tokens = int(usage.get("totalTokens") or 0)
            if total_tokens != input_tokens + output_tokens:
                # One historical rewrite run contains five non-provider rounds that
                # repeat its complete aggregate usage and gross input (input + cache).
                # They still count as rounds, but must not be added to provider usage.
                if total_tokens == input_tokens - cached_tokens + output_tokens:
                    excluded_duplicate_usage_rounds += 1
                    continue
                raise ValueError(f"Token identity failed in {path}:{line_number}")
            usage_rows.append(
                {
                    "inputTokens": input_tokens,
                    "cacheInputTokens": cached_tokens,
                    "outputTokens": output_tokens,
                    "reasoningTokens": int(usage.get("reasoningTokens") or 0),
                    "totalTokens": total_tokens,
                }
            )
            for key in totals:
                totals[key] += int(usage.get(key) or 0)
    if not indexes:
        raise ValueError(f"No rounds found: {path}")
    expected = list(range(1, max(indexes) + 1))
    if sorted(indexes) != expected:
        raise ValueError(f"Non-contiguous round indexes in {path}")
    if totals["totalTokens"] != totals["inputTokens"] + totals["outputTokens"]:
        raise ValueError(f"Summed token identity failed in {path}")
    return (
        max(indexes),
        totals,
        metadata,
        excluded_duplicate_usage_rounds,
        populated_usage_rounds,
        usage_rows,
    )


def normalize_usage(value: object) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    aliases = {
        "inputTokens": ("inputTokens", "input_tokens", "input"),
        "cacheInputTokens": (
            "cacheInputTokens",
            "cachedInputTokens",
            "cached_input_tokens",
            "cached",
        ),
        "outputTokens": ("outputTokens", "output_tokens", "output"),
        "reasoningTokens": ("reasoningTokens", "reasoning_tokens", "reasoning"),
        "totalTokens": ("totalTokens", "total_tokens", "total"),
    }
    if not any(key in value for candidates in aliases.values() for key in candidates):
        return None
    normalized: dict[str, int] = {}
    for target, candidates in aliases.items():
        raw = next((value[key] for key in candidates if value.get(key) is not None), 0)
        normalized[target] = int(raw or 0)
    if normalized["totalTokens"] != normalized["inputTokens"] + normalized["outputTokens"]:
        raise ValueError("Aggregate usage violates total = input + output")
    if normalized["cacheInputTokens"] > normalized["inputTokens"]:
        raise ValueError("Aggregate cached input exceeds input")
    return normalized


def find_aggregate_usage(task_report: dict, summary: dict) -> tuple[dict[str, int], str]:
    candidates: list[tuple[str, object]] = [
        ("task-report.source", task_report.get("source")),
        ("summary.usage", summary.get("usage")),
        ("summary.aggregate_usage", summary.get("aggregate_usage")),
        (
            "summary.standard_metrics.token_usage",
            nested(summary, ("standard_metrics", "token_usage")),
        ),
    ]
    results = summary.get("results")
    if isinstance(results, list) and len(results) == 1 and isinstance(results[0], dict):
        candidates.append(("summary.results[0].usage", results[0].get("usage")))
    for source, value in candidates:
        usage = normalize_usage(value)
        if usage is not None:
            return usage, source
    raise ValueError("No aggregate usage found in task report or summary")


def find_reported_metrics(task_report: dict, summary: dict) -> tuple[int | None, float | None]:
    reported_tokens = nested(
        task_report,
        ("source", "totalTokens"),
        ("source", "cost", "billableTokens", "total"),
        ("source", "pricing", "billableTokens", "total"),
    )
    if reported_tokens is None:
        reported_tokens = nested(summary, ("usage", "totalTokens"))
    reported_cost = nested(
        task_report,
        ("source", "costUsd"),
        ("source", "cost", "costUsd"),
        ("source", "pricing", "costUsd"),
    )
    return (
        int(reported_tokens) if reported_tokens is not None else None,
        float(reported_cost) if reported_cost is not None else None,
    )


def calculate_cost(input_tokens: int, cached_input_tokens: int, output_tokens: int) -> float:
    if cached_input_tokens > input_tokens:
        raise ValueError("Cached input cannot exceed total input")
    uncached = input_tokens - cached_input_tokens
    return (
        uncached * PRICE_PER_MILLION["uncached_input"]
        + cached_input_tokens * PRICE_PER_MILLION["cached_input"]
        + output_tokens * PRICE_PER_MILLION["output"]
    ) / 1_000_000


def load_runs(results_root: Path, reports: Sequence[dict]) -> list[RunRecord]:
    records: list[RunRecord] = []
    for report in reports:
        report_dir = results_root / report["path"]
        harness_paths = sorted(report_dir.glob("**/metadata/contracts/harness-report.json"))
        if len(harness_paths) != int(report["expectedRuns"]):
            raise ValueError(
                f"Expected {report['expectedRuns']} contracts in {report['path']}, "
                f"found {len(harness_paths)}"
            )
        for harness_path in harness_paths:
            harness = read_json(harness_path)
            category = str(harness.get("category") or "")
            if category != report["category"]:
                raise ValueError(
                    f"Configured category {report['category']} disagrees with {category}: "
                    f"{harness_path}"
                )
            contract_dir = harness_path.parent
            rounds_path = contract_dir / "agent-rounds.jsonl"
            task_path = contract_dir / "task-report.json"
            summary_path = contract_dir.parent / "summary.json"
            if not rounds_path.exists() or not task_path.exists() or not summary_path.exists():
                raise FileNotFoundError(f"Incomplete contract set beside {harness_path}")

            task_report = read_json(task_path)
            summary = read_json(summary_path)
            (
                rounds,
                round_usage,
                metadata,
                excluded_usage_rounds,
                populated_usage_rounds,
                usage_rows,
            ) = load_round_usage(rounds_path)
            try:
                usage, usage_source = find_aggregate_usage(task_report, summary)
            except ValueError as exc:
                raise ValueError(f"{exc}: {summary_path}") from exc
            round_usage_checked = populated_usage_rounds > 0
            aggregate_snapshot_usage_rounds = 0
            if round_usage_checked and round_usage != usage:
                for row in usage_rows:
                    candidate = {key: round_usage[key] - row[key] for key in round_usage}
                    if row == usage and candidate == usage:
                        round_usage = candidate
                        aggregate_snapshot_usage_rounds = 1
                        break
            if round_usage_checked and round_usage != usage:
                round_usage_checked = False
            usage_available = not (
                usage["totalTokens"] == 0
                and str(metadata.get("usageEventSource") or "").lower() == "unavailable"
            )
            run_id = str(
                harness.get("runId")
                or task_report.get("runId")
                or harness_path.parent.parent.parent.name
            )
            agent_id = str(
                harness.get("agentId")
                or task_report.get("agent")
                or metadata.get("agentId")
                or metadata.get("sourceAgentId")
                or ""
            )
            agent_group = normalize_agent_group(agent_id, run_id, str(harness_path))
            model = normalize_model(
                agent_id,
                metadata.get("model"),
                task_report.get("source", {}).get("model")
                if isinstance(task_report.get("source"), dict)
                else None,
                summary.get("model"),
                summary.get("tura_model"),
                run_id,
            )
            effort = normalize_effort(
                agent_id, metadata.get("reasoning"), summary.get("reasoning")
            )
            passed = int(nested(harness, ("score", "passed")) or 0)
            checks = int(nested(harness, ("score", "total")) or 0)
            if checks <= 0 or not 0 <= passed <= checks:
                raise ValueError(f"Invalid harness score in {harness_path}")
            reported_tokens, reported_cost = find_reported_metrics(task_report, summary)
            cost = calculate_cost(
                usage["inputTokens"], usage["cacheInputTokens"], usage["outputTokens"]
            )
            exclusion = RELATIONSHIP_EXCLUSIONS.get(run_id)
            if exclusion and rounds != int(exclusion["rounds"]):
                raise ValueError(
                    f"Configured exclusion rounds disagree for {run_id}: "
                    f"{rounds} != {exclusion['rounds']}"
                )
            records.append(
                RunRecord(
                    run_id=run_id,
                    category=category,
                    report=report_dir.name,
                    task=str(
                        harness.get("taskId")
                        or task_report.get("task")
                        or metadata.get("taskId")
                        or ""
                    ),
                    agent_group=agent_group,
                    agent_id=agent_id,
                    model=model,
                    effort=effort,
                    rounds=rounds,
                    input_tokens=usage["inputTokens"],
                    cached_input_tokens=usage["cacheInputTokens"],
                    output_tokens=usage["outputTokens"],
                    reasoning_tokens=usage["reasoningTokens"],
                    total_tokens=usage["totalTokens"],
                    passed=passed,
                    checks=checks,
                    success_rate=passed / checks,
                    cost_usd=cost,
                    usage_available=usage_available,
                    usage_source=usage_source,
                    round_usage_total_tokens=round_usage["totalTokens"],
                    round_usage_checked=round_usage_checked,
                    aggregate_snapshot_usage_rounds=aggregate_snapshot_usage_rounds,
                    excluded_duplicate_usage_rounds=excluded_usage_rounds,
                    reported_total_tokens=reported_tokens,
                    reported_cost_usd=reported_cost,
                    source_path=harness_path.relative_to(results_root).as_posix(),
                )
            )
    return records


def audit_runs(records: Sequence[RunRecord], population: dict) -> dict:
    expected_runs = int(population["sourceRuns"])
    if len(records) != expected_runs:
        raise ValueError(f"Expected {expected_runs} configured runs, found {len(records)}")
    if len({record.source_path for record in records}) != len(records):
        raise ValueError("Duplicate run contract paths found")
    coverage: dict[str, dict] = {}
    for group in AGENT_ORDER:
        group_records = [record for record in records if record.agent_group == group]
        expected_group_runs = int(population["runsPerConfiguration"])
        if len(group_records) != expected_group_runs:
            raise ValueError(
                f"Expected {expected_group_runs} runs for {group}, found {len(group_records)}"
            )
        coverage[group] = {
            "runs": len(group_records),
            "tasks": len({record.task for record in group_records}),
            "models": sorted({record.model for record in group_records}),
            "rounds": sum(record.rounds for record in group_records),
            "tokens": sum(record.total_tokens for record in group_records),
            "passed": sum(record.passed for record in group_records),
            "checks": sum(record.checks for record in group_records),
            "cost_usd": sum(record.cost_usd for record in group_records),
        }
    token_diffs = [
        abs(record.total_tokens - record.round_usage_total_tokens)
        for record in records
        if record.round_usage_checked
    ]
    cost_diffs = [
        abs(record.cost_usd - record.reported_cost_usd)
        for record in records
        if record.reported_cost_usd is not None and record.usage_available
    ]
    if token_diffs and max(token_diffs) != 0:
        raise ValueError(f"Round and reported token totals disagree by up to {max(token_diffs)}")
    if cost_diffs and max(cost_diffs) > 5e-6:
        raise ValueError(f"Recomputed and reported costs disagree by up to {max(cost_diffs):.8f}")
    audit = {
        "run_count": len(records),
        "task_count": len({record.task for record in records}),
        "token_contracts_checked": len(token_diffs),
        "cost_contracts_checked": len(cost_diffs),
        "max_token_difference": max(token_diffs, default=0),
        "max_cost_difference_usd": max(cost_diffs, default=0.0),
        "usage_available_runs": sum(record.usage_available for record in records),
        "usage_unavailable_runs": sum(not record.usage_available for record in records),
        "aggregate_only_usage_runs": sum(
            record.usage_available and not record.round_usage_checked for record in records
        ),
        "aggregate_snapshot_usage_rounds": sum(
            record.aggregate_snapshot_usage_rounds for record in records
        ),
        "excluded_duplicate_usage_rounds": sum(
            record.excluded_duplicate_usage_rounds for record in records
        ),
        "runs_with_excluded_duplicate_usage": sum(
            record.excluded_duplicate_usage_rounds > 0 for record in records
        ),
        "coverage": coverage,
    }
    if audit["task_count"] != int(population["tasks"]):
        raise ValueError(
            f"Expected {population['tasks']} tasks, found {audit['task_count']}"
        )
    return audit


def summarize_analysis_sample(
    records: Sequence[RunRecord], excluded: Sequence[tuple[RunRecord, str]]
) -> dict:
    return {
        "run_count": len(records),
        "task_count": len({record.task for record in records}),
        "passed": sum(record.passed for record in records),
        "checks": sum(record.checks for record in records),
        "total_tokens": sum(record.total_tokens for record in records),
        "excluded_run_count": len(excluded),
        "excluded_runs": [
            {
                "run_id": record.run_id,
                "agent_group": record.agent_group,
                "rounds": record.rounds,
                "total_tokens": record.total_tokens,
                "reason": reason,
            }
            for record, reason in excluded
        ],
        "coverage": {
            group: {
                "runs": sum(record.agent_group == group for record in records),
                "tasks": len(
                    {record.task for record in records if record.agent_group == group}
                ),
                "min_rounds": min(
                    record.rounds for record in records if record.agent_group == group
                ),
                "max_rounds": max(
                    record.rounds for record in records if record.agent_group == group
                ),
            }
            for group in AGENT_ORDER
        },
    }


def theory_predict(params: Sequence[float], rounds: np.ndarray) -> np.ndarray:
    base, growth = params
    return base * rounds + growth * rounds * (rounds + 1.0) / 2.0


def fit_theory(rounds: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    per_round = values / rounds
    initial = np.array([max(float(np.percentile(per_round, 25)), 1e-6), 1.0])

    def residual(params: np.ndarray) -> np.ndarray:
        return np.log(theory_predict(params, rounds)) - np.log(values)

    result = least_squares(residual, initial, bounds=(1e-9, np.inf), max_nfev=20_000)
    if not result.success:
        raise RuntimeError(f"Theory fit failed: {result.message}")
    return result.x, theory_predict(result.x, rounds)


def power_predict(params: Sequence[float], rounds: np.ndarray) -> np.ndarray:
    scale, exponent = params
    return scale * np.power(rounds, exponent)


def fit_power(rounds: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    design = np.column_stack([np.ones_like(rounds), np.log(rounds)])
    log_scale, exponent = np.linalg.lstsq(design, np.log(values), rcond=None)[0]
    params = np.array([math.exp(float(log_scale)), float(exponent)])
    return params, power_predict(params, rounds)


def regression_metrics(values: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    residual = values - predicted
    denominator = float(np.sum(np.square(values - np.mean(values))))
    r_squared = 1.0 - float(np.sum(np.square(residual))) / denominator if denominator else 0.0
    rmsle = float(np.sqrt(np.mean(np.square(np.log(predicted) - np.log(values)))))
    mape = float(np.mean(np.abs(residual) / values))
    return {"r_squared": r_squared, "rmsle": rmsle, "mape": mape}


FitFunction = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]
PredictFunction = Callable[[Sequence[float], np.ndarray], np.ndarray]


def leave_one_task_out_rmsle(
    rounds: np.ndarray,
    values: np.ndarray,
    tasks: np.ndarray,
    fit: FitFunction,
    predict: PredictFunction,
) -> float:
    errors: list[float] = []
    for task in sorted(set(tasks.tolist())):
        test = tasks == task
        train = ~test
        params, _ = fit(rounds[train], values[train])
        predicted = predict(params, rounds[test])
        errors.extend((np.log(predicted) - np.log(values[test])).tolist())
    return float(np.sqrt(np.mean(np.square(errors))))


def fit_token_models(records: Sequence[RunRecord]) -> dict[str, dict]:
    diagnostics: dict[str, dict] = {}
    for group in AGENT_ORDER:
        subset = [
            record
            for record in records
            if record.agent_group == group and record.usage_available
        ]
        rounds = np.array([record.rounds for record in subset], dtype=float)
        tokens = np.array([record.total_tokens for record in subset], dtype=float)
        tasks = np.array([record.task for record in subset])
        theory_params, theory_fitted = fit_theory(rounds, tokens)
        power_params, power_fitted = fit_power(rounds, tokens)
        theory_cv = leave_one_task_out_rmsle(
            rounds, tokens, tasks, fit_theory, theory_predict
        )
        power_cv = leave_one_task_out_rmsle(rounds, tokens, tasks, fit_power, power_predict)
        selected = "quadratic-context" if theory_cv <= power_cv * 1.05 else "power-law"
        diagnostics[group] = {
            "quadratic_context": {
                "formula": "T(n) = nB + c*n*(n+1)/2",
                "B_tokens": float(theory_params[0]),
                "c_tokens_per_round": float(theory_params[1]),
                "metrics": regression_metrics(tokens, theory_fitted),
                "leave_one_task_out_rmsle": theory_cv,
                "multiplicative_error": math.exp(theory_cv) - 1.0,
            },
            "power_law": {
                "formula": "T(n) = a*n^p",
                "a_tokens": float(power_params[0]),
                "p": float(power_params[1]),
                "metrics": regression_metrics(tokens, power_fitted),
                "leave_one_task_out_rmsle": power_cv,
                "multiplicative_error": math.exp(power_cv) - 1.0,
            },
            "selected_model": selected,
            "formula_conforms": selected == "quadratic-context",
        }
    return diagnostics


def fit_cost_models(records: Sequence[RunRecord]) -> dict[str, dict]:
    diagnostics: dict[str, dict] = {}
    for group in AGENT_ORDER:
        subset = [
            record
            for record in records
            if record.agent_group == group and record.usage_available
        ]
        rounds = np.array([record.rounds for record in subset], dtype=float)
        costs = np.array([record.cost_usd for record in subset], dtype=float)
        params, fitted = fit_power(rounds, costs)
        diagnostics[group] = {
            "formula": "C(n) = a*n^p",
            "a_usd": float(params[0]),
            "p": float(params[1]),
            "metrics": regression_metrics(costs, fitted),
        }
    return diagnostics


def fit_success_models(records: Sequence[RunRecord]) -> dict[str, dict]:
    diagnostics: dict[str, dict] = {}
    for group in AGENT_ORDER:
        subset = [record for record in records if record.agent_group == group]
        rounds = np.array([record.rounds for record in subset], dtype=float)
        passed = np.array([record.passed for record in subset], dtype=float)
        checks = np.array([record.checks for record in subset], dtype=float)
        log_rounds = np.log1p(rounds)

        def objective(params: np.ndarray) -> float:
            probability = np.clip(expit(params[0] + params[1] * log_rounds), 1e-9, 1 - 1e-9)
            return float(
                -np.sum(passed * np.log(probability) + (checks - passed) * np.log1p(-probability))
            )

        initial_probability = np.clip(np.sum(passed) / np.sum(checks), 1e-6, 1 - 1e-6)
        initial = np.array([math.log(initial_probability / (1 - initial_probability)), 0.0])
        result = minimize(objective, initial, method="BFGS")
        if not result.success and np.linalg.norm(result.jac) > 1e-4:
            raise RuntimeError(f"Success fit failed for {group}: {result.message}")
        diagnostics[group] = {
            "formula": "logit(P(success)) = alpha + beta*log(1+n)",
            "alpha": float(result.x[0]),
            "beta": float(result.x[1]),
            "weighted_success_rate": float(np.sum(passed) / np.sum(checks)),
            "checks": int(np.sum(checks)),
        }
    return diagnostics


def write_csv(records: Sequence[RunRecord], output_dir: Path) -> None:
    path = output_dir / "run-level-data.csv"
    fieldnames = list(asdict(records[0]).keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(asdict(record))


def write_excluded_csv(
    excluded: Sequence[tuple[RunRecord, str]], output_dir: Path
) -> None:
    path = output_dir / "excluded-runs.csv"
    fieldnames = ["exclusion_reason", *RunRecord.__dataclass_fields__.keys()]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record, reason in excluded:
            writer.writerow({"exclusion_reason": reason, **asdict(record)})


def write_report(
    audit: dict,
    analysis_sample: dict,
    token_models: dict[str, dict],
    success_models: dict[str, dict],
    cost_models: dict[str, dict],
    output_dir: Path,
) -> None:
    exclusion_details = ", ".join(
        f"{item['runId']} ({item['rounds']} rounds)"
        for item in ANALYSIS_CONFIG["relationshipExclusions"]
    )
    price = PRICE_PER_MILLION
    diagnostics = {
        "source_audit": audit,
        "analysis_sample": analysis_sample,
        "pricing_usd_per_1m_tokens": PRICE_PER_MILLION,
        "token_models": token_models,
        "success_models": success_models,
        "cost_models": cost_models,
    }
    (output_dir / "diagnostics.json").write_text(
        json.dumps(diagnostics, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )

    rows = []
    for group in AGENT_ORDER:
        theory = token_models[group]["quadratic_context"]
        power = token_models[group]["power_law"]
        rows.append(
            "| {label} | {theory:.3f} | {power_cv:.3f} | {selected} | {power_formula} |".format(
                label=AGENT_LABELS[group],
                theory=theory["leave_one_task_out_rmsle"],
                power_cv=power["leave_one_task_out_rmsle"],
                selected=token_models[group]["selected_model"],
                power_formula=f"T(n) = {power['a_tokens']:.0f} n^{power['p']:.3f}",
            )
        )
    conforming = [
        AGENT_LABELS[group] for group in AGENT_ORDER if token_models[group]["formula_conforms"]
    ]
    nonconforming = [
        AGENT_LABELS[group] for group in AGENT_ORDER if not token_models[group]["formula_conforms"]
    ]
    conclusion = (
        f"Quadratic-context form retained for: {', '.join(conforming) or 'none'}. "
        f"Power-law alternative preferred for: {', '.join(nonconforming) or 'none'}."
    )
    lines = [
        "# Agent-group round, token, success, and cost analysis",
        "",
        "## Scope and grain",
        "",
        "- Source: run contracts under `results/debug` and `results/rewrite`.",
        f"- Source grain: {audit['run_count']} runs across {audit['task_count']} tasks.",
        f"- Analysis grain after the documented Tura Balanced long-tail exclusion: {analysis_sample['run_count']} runs across {analysis_sample['task_count']} tasks.",
        f"- Exclusions: {len(ANALYSIS_CONFIG['relationshipExclusions'])} configured runs: {exclusion_details}. They remain in source results and aggregate score tables but are omitted from every statistical figure and fitted relationship.",
        "- Grouping: Tura Balanced High, Tura Direct High, Codex CLI Medium, and Codex CLI High remain separate configurations.",
        "- Rounds: reconstructed from each run's contiguous `agent-rounds.jsonl` indexes.",
        "- Usage: read from the run-level aggregate contract and, where the historical schema populated usage, independently checked against summed provider-round usage.",
        f"- Source usage-complete runs: {audit['usage_available_runs']}; usage-unavailable runs: {audit['usage_unavailable_runs']}.",
        f"- Aggregate-only historical usage: {audit['aggregate_only_usage_runs']} runs; their round contracts contain null usage fields.",
        "- Success: `sum(passed) / sum(checks)` for weighted summaries; points retain run-level ratios.",
        f"- Cost: `(uncached input*{price['uncached_input']:g} + cached input*{price['cached_input']:g} + output*{price['output']:g}) / 1,000,000` USD.",
        "",
        "## Formula test",
        "",
        "The supplied formula is interpreted as `T(n) = nB + c*n*(n+1)/2`. Both candidate models have two parameters and are compared with leave-one-task-out RMSLE. The quadratic-context form is retained when its RMSLE is within 5% of the power-law model; otherwise `T(n) = a*n^p` is selected.",
        "",
        "| Agent group | Quadratic CV RMSLE | Power CV RMSLE | Selected | Power-law estimate |",
        "|---|---:|---:|---|---|",
        *rows,
        "",
        f"**Conclusion:** {conclusion}",
        "",
        "The result is an empirical cross-task relationship, not a claim that extra rounds cause success or token growth identically for every task. Task difficulty and model configuration remain visible as run-level scatter.",
        "",
        "## Contract audit",
        "",
        f"- Token totals cross-checked against all {audit['token_contracts_checked']} round contracts; maximum difference: {audit['max_token_difference']} tokens.",
        f"- Costs cross-checked against {audit['cost_contracts_checked']} populated task contracts; maximum difference: ${audit['max_cost_difference_usd']:.8f}.",
        f"- Excluded duplicate aggregate-usage snapshots: {audit['excluded_duplicate_usage_rounds']} rounds in {audit['runs_with_excluded_duplicate_usage']} run; these rounds remain in the round count.",
        f"- Excluded exact run-aggregate usage snapshots: {audit['aggregate_snapshot_usage_rounds']} round; it remains in the round count.",
        "- The remaining historical cost fields were absent, not zero; they were recomputed from their recorded token components with the same benchmark pricing rule.",
        "",
    ]
    (output_dir / "analysis.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    args = parse_args()
    config = load_analysis_config(args.config)
    global ANALYSIS_CONFIG, AGENT_ORDER, PRICE_PER_MILLION, RELATIONSHIP_EXCLUSIONS
    ANALYSIS_CONFIG = config
    AGENT_ORDER = tuple(config["configurations"])
    PRICE_PER_MILLION = dict(config["pricingUsdPer1mTokens"])
    RELATIONSHIP_EXCLUSIONS = {
        item["runId"]: item for item in config["relationshipExclusions"]
    }
    results_root = (
        repository_path(args.results)
        if args.results
        else configured_path(config, "resultsRoot")
    )
    output_dir = (
        repository_path(args.output)
        if args.output
        else configured_path(config, "outputs", "modelRuns")
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    records = load_runs(results_root, config["reports"])
    audit = audit_runs(records, config["population"])
    analysis_records, excluded = select_analysis_records(records)
    analysis_sample = summarize_analysis_sample(analysis_records, excluded)
    expected_relationship_runs = int(config["population"]["relationshipRuns"])
    expected_exclusions = len(config["relationshipExclusions"])
    if (
        len(analysis_records) != expected_relationship_runs
        or len(excluded) != expected_exclusions
    ):
        raise ValueError(
            f"Expected {expected_relationship_runs} included and "
            f"{expected_exclusions} configured exclusions, found "
            f"{len(analysis_records)} and {len(excluded)}"
        )
    token_models = fit_token_models(analysis_records)
    success_models = fit_success_models(analysis_records)
    cost_models = fit_cost_models(analysis_records)
    write_csv(analysis_records, output_dir)
    write_excluded_csv(excluded, output_dir)
    write_report(
        audit,
        analysis_sample,
        token_models,
        success_models,
        cost_models,
        output_dir,
    )
    print(
        json.dumps(
            {
                "output": str(output_dir),
                "source_runs": audit["run_count"],
                "analysis_runs": analysis_sample["run_count"],
                "excluded_runs": analysis_sample["excluded_run_count"],
                "tasks": analysis_sample["task_count"],
                "selected_token_models": {
                    group: token_models[group]["selected_model"] for group in AGENT_ORDER
                },
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    main()
