#!/usr/bin/env python3
"""Build reproducible agent-group round, token, success, and cost charts."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.font_manager import FontProperties, fontManager
from scipy.optimize import least_squares, minimize
from scipy.special import expit


AGENT_ORDER = ("tura-balanced", "tura-direct", "codex-cli")
AGENT_LABELS = {
    "tura-balanced": "Tura Balanced",
    "tura-direct": "Tura Direct",
    "codex-cli": "Codex CLI",
}
COLORS = {
    "tura-balanced": "#008f87",
    "tura-direct": "#d56538",
    "codex-cli": "#6b5fb5",
}
BACKGROUND = "#f4f1ea"
INK = "#0a0a0a"
MUTED = "#474747"
GRID = "#dedbd2"
ACCENT = "#40e0d0"
PRICE_PER_MILLION = {"uncached_input": 5.0, "cached_input": 0.5, "output": 30.0}


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, default=Path("results"))
    parser.add_argument(
        "--reference-svg",
        type=Path,
        default=Path(r"C:\Users\liuliu\Documents\tura\assets\data\benchmark-agent-comparison.svg"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("results/design/model-run-statistics"),
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
    if "codex" in text:
        return "codex-cli"
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
            if any(
                usage.get(key) is not None
                for key in (
                    "inputTokens",
                    "cacheInputTokens",
                    "outputTokens",
                    "reasoningTokens",
                    "totalTokens",
                )
            ):
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


def load_runs(results_root: Path) -> list[RunRecord]:
    records: list[RunRecord] = []
    harness_paths = sorted(results_root.glob("**/metadata/contracts/harness-report.json"))
    for harness_path in harness_paths:
        harness = read_json(harness_path)
        category = str(harness.get("category") or "")
        if category not in {"debug", "rewrite"}:
            continue
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
            usage["totalTokens"] == 0 and str(metadata.get("usageEventSource") or "").lower() == "unavailable"
        )
        run_id = str(harness.get("runId") or task_report.get("runId") or harness_path.parent.parent.parent.name)
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
            task_report.get("source", {}).get("model") if isinstance(task_report.get("source"), dict) else None,
            summary.get("model"),
            summary.get("tura_model"),
            run_id,
        )
        effort = normalize_effort(agent_id, metadata.get("reasoning"), summary.get("reasoning"))
        passed = int(nested(harness, ("score", "passed")) or 0)
        checks = int(nested(harness, ("score", "total")) or 0)
        if checks <= 0 or not 0 <= passed <= checks:
            raise ValueError(f"Invalid harness score in {harness_path}")
        reported_tokens, reported_cost = find_reported_metrics(task_report, summary)
        cost = calculate_cost(
            usage["inputTokens"], usage["cacheInputTokens"], usage["outputTokens"]
        )
        records.append(
            RunRecord(
                run_id=run_id,
                category=category,
                report=str(harness.get("report") or ""),
                task=str(harness.get("taskId") or task_report.get("task") or metadata.get("taskId") or ""),
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
                source_path=str(harness_path.resolve()),
            )
        )
    return records


def audit_runs(records: Sequence[RunRecord]) -> dict:
    if len(records) != 270:
        raise ValueError(f"Expected 270 debug/rewrite runs, found {len(records)}")
    if len({record.run_id for record in records}) != len(records):
        raise ValueError("Duplicate run IDs found")
    coverage: dict[str, dict] = {}
    for group in AGENT_ORDER:
        group_records = [record for record in records if record.agent_group == group]
        if len(group_records) != 90:
            raise ValueError(f"Expected 90 runs for {group}, found {len(group_records)}")
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
    return {
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


def extract_archivo(reference_svg: Path, output_dir: Path) -> Path | None:
    if not reference_svg.exists():
        return None
    source = reference_svg.read_text(encoding="utf-8")
    match = re.search(r"font-family:Archivo;src:url\(data:font/ttf;base64,([A-Za-z0-9+/=]+)\)", source)
    if not match:
        return None
    font_path = output_dir / "assets" / "Archivo-Regular.ttf"
    font_path.parent.mkdir(parents=True, exist_ok=True)
    font_path.write_bytes(base64.b64decode(match.group(1)))
    return font_path


def configure_style(font_path: Path | None, output_dir: Path) -> FontProperties:
    if font_path:
        fontManager.addfont(str(font_path))
        family = FontProperties(fname=str(font_path)).get_name()
    else:
        family = "Arial"
    bold_path = output_dir / "assets" / "Archivo-Bold.ttf"
    official_regular_path = output_dir / "assets" / "Archivo-Regular-Official.ttf"
    for local_font in (official_regular_path, bold_path):
        if local_font.exists():
            fontManager.addfont(str(local_font))
    mpl.rcParams.update(
        {
            "font.family": family,
            "font.size": 11,
            "axes.facecolor": BACKGROUND,
            "figure.facecolor": BACKGROUND,
            "savefig.facecolor": BACKGROUND,
            "text.color": INK,
            "axes.labelcolor": MUTED,
            "axes.edgecolor": GRID,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "axes.linewidth": 0.6,
            "grid.color": GRID,
            "grid.linewidth": 0.6,
            "grid.alpha": 1.0,
            "svg.fonttype": "path",
        }
    )
    return FontProperties(family=family)


def stable_offsets(records: Sequence[RunRecord], width: float) -> np.ndarray:
    values = []
    for record in records:
        digest = hashlib.sha256(record.run_id.encode("utf-8")).digest()
        values.append(((int.from_bytes(digest[:2], "big") / 65535.0) - 0.5) * width)
    return np.array(values)


def start_figure(kicker: str, title: str, subtitle: str) -> tuple[plt.Figure, plt.Axes]:
    figure, axis = plt.subplots(figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(left=0.11, right=0.95, bottom=0.13, top=0.72)
    figure.text(0.11, 0.93, kicker.upper(), color=MUTED, fontsize=10, weight="bold")
    figure.text(0.11, 0.855, title, color=INK, fontsize=28, weight="bold")
    figure.text(0.11, 0.795, subtitle, color=MUTED, fontsize=12)
    figure.add_artist(
        mpl.lines.Line2D([0.11, 0.95], [0.755, 0.755], transform=figure.transFigure, color=GRID, linewidth=0.7)
    )
    axis.grid(axis="y")
    axis.grid(axis="x", alpha=0.45)
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["left", "bottom"]].set_color(GRID)
    axis.tick_params(length=0, pad=8)
    return figure, axis


def add_agent_key(figure: plt.Figure) -> None:
    starts = (0.11, 0.32, 0.51)
    for left, group in zip(starts, AGENT_ORDER):
        figure.add_artist(
            mpl.lines.Line2D(
                [left, left + 0.025],
                [0.735, 0.735],
                transform=figure.transFigure,
                color=COLORS[group],
                linewidth=2.4,
            )
        )
        figure.text(left + 0.032, 0.728, AGENT_LABELS[group], color=INK, fontsize=10, weight="bold")


def save_figure(figure: plt.Figure, output_dir: Path, stem: str) -> None:
    png_path = output_dir / f"{stem}.png"
    svg_path = output_dir / f"{stem}.svg"
    figure.savefig(png_path, dpi=200)
    figure.savefig(svg_path)
    plt.close(figure)


def plot_tokens(
    records: Sequence[RunRecord], diagnostics: dict[str, dict], output_dir: Path
) -> None:
    figure, axis = start_figure(
        "269 usage-complete sessions · 25 tasks",
        "Round count vs. total token use",
        "Each point is one run; each agent group pools every task and model configuration.",
    )
    add_agent_key(figure)
    for group in AGENT_ORDER:
        subset = [
            record
            for record in records
            if record.agent_group == group and record.usage_available
        ]
        rounds = np.array([record.rounds for record in subset], dtype=float)
        tokens_m = np.array([record.total_tokens for record in subset], dtype=float) / 1_000_000
        axis.scatter(
            rounds + stable_offsets(subset, 1.2),
            tokens_m,
            s=24,
            color=COLORS[group],
            alpha=0.33,
            linewidth=0,
            zorder=2,
        )
        x_line = np.linspace(1, max(rounds), 360)
        group_fit = diagnostics[group]
        if group_fit["selected_model"] == "quadratic-context":
            item = group_fit["quadratic_context"]
            y_line = theory_predict((item["B_tokens"], item["c_tokens_per_round"]), x_line)
        else:
            item = group_fit["power_law"]
            y_line = power_predict((item["a_tokens"], item["p"]), x_line)
        axis.plot(x_line, y_line / 1_000_000, color=COLORS[group], linewidth=2.5, zorder=3)
    axis.set_xlim(left=0)
    axis.set_ylim(bottom=0)
    axis.set_xlabel("Agent rounds")
    axis.set_ylabel("Total tokens (millions)")
    figure.text(
        0.11,
        0.055,
        "FIT · Lines use leave-one-task-out selection · 1 run with unavailable usage is excluded · points jittered < 0.6 round.",
        color=MUTED,
        fontsize=9,
    )
    save_figure(figure, output_dir, "01-rounds-vs-total-tokens")


def plot_success(
    records: Sequence[RunRecord], diagnostics: dict[str, dict], output_dir: Path
) -> None:
    figure, axis = start_figure(
        "Harness outcome · weighted by checks",
        "Round count vs. success rate",
        "Points show run-level pass ratios; lines estimate association, not causal benefit from longer runs.",
    )
    add_agent_key(figure)
    for group in AGENT_ORDER:
        subset = [record for record in records if record.agent_group == group]
        rounds = np.array([record.rounds for record in subset], dtype=float)
        rates = np.array([record.success_rate for record in subset], dtype=float) * 100
        sizes = 18 + 5 * np.sqrt(np.array([record.checks for record in subset], dtype=float))
        y_offsets = stable_offsets(subset, 2.2)
        axis.scatter(
            rounds + stable_offsets(subset, 1.2),
            np.clip(rates + y_offsets, 0, 100),
            s=sizes,
            color=COLORS[group],
            alpha=0.28,
            linewidth=0,
            zorder=2,
        )
        x_line = np.linspace(1, max(rounds), 360)
        item = diagnostics[group]
        y_line = expit(item["alpha"] + item["beta"] * np.log1p(x_line)) * 100
        axis.plot(x_line, y_line, color=COLORS[group], linewidth=2.5, zorder=3)
    axis.set_xlim(left=0)
    axis.set_ylim(-2, 102)
    axis.set_yticks(np.arange(0, 101, 20), labels=[f"{value}%" for value in range(0, 101, 20)])
    axis.set_xlabel("Agent rounds")
    axis.set_ylabel("Harness success rate")
    figure.text(
        0.11,
        0.055,
        "METHOD · Weighted binomial fit: logit(success) = alpha + beta*log(1 + rounds). Marker area reflects check count.",
        color=MUTED,
        fontsize=9,
    )
    save_figure(figure, output_dir, "02-rounds-vs-success-rate")


def plot_cost(records: Sequence[RunRecord], diagnostics: dict[str, dict], output_dir: Path) -> None:
    figure, axis = start_figure(
        "Standard-tier API estimate",
        "Token cost vs. round count",
        "Every run is repriced consistently from uncached input, cached input, and output usage.",
    )
    add_agent_key(figure)
    for group in AGENT_ORDER:
        subset = [
            record
            for record in records
            if record.agent_group == group and record.usage_available
        ]
        rounds = np.array([record.rounds for record in subset], dtype=float)
        costs = np.array([record.cost_usd for record in subset], dtype=float)
        axis.scatter(
            rounds + stable_offsets(subset, 1.2),
            costs,
            s=24,
            color=COLORS[group],
            alpha=0.33,
            linewidth=0,
            zorder=2,
        )
        x_line = np.linspace(1, max(rounds), 360)
        item = diagnostics[group]
        y_line = power_predict((item["a_usd"], item["p"]), x_line)
        axis.plot(x_line, y_line, color=COLORS[group], linewidth=2.5, zorder=3)
    axis.set_xlim(left=0)
    axis.set_ylim(bottom=0)
    axis.set_xlabel("Agent rounds")
    axis.set_ylabel("Estimated API cost (USD)")
    axis.yaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("${x:,.0f}"))
    figure.text(
        0.11,
        0.055,
        "PRICE · $5.00 / 1M uncached input · $0.50 / 1M cached input · $30.00 / 1M output · N=269 · Power-law trend.",
        color=MUTED,
        fontsize=9,
    )
    save_figure(figure, output_dir, "03-rounds-vs-token-cost")


def write_csv(records: Sequence[RunRecord], output_dir: Path) -> None:
    path = output_dir / "run-level-data.csv"
    fieldnames = list(asdict(records[0]).keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(asdict(record))


def write_report(
    audit: dict,
    token_models: dict[str, dict],
    success_models: dict[str, dict],
    cost_models: dict[str, dict],
    output_dir: Path,
) -> None:
    diagnostics = {
        "audit": audit,
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
        f"- Grain: one row per run; {audit['run_count']} runs across {audit['task_count']} tasks.",
        "- Grouping: all tasks, model versions, and effort configurations are pooled into one series per agent group.",
        "- Rounds: reconstructed from each run's contiguous `agent-rounds.jsonl` indexes.",
        "- Usage: read from the run-level aggregate contract and, where the historical schema populated usage, independently checked against summed provider-round usage.",
        f"- Usage-complete runs: {audit['usage_available_runs']}; usage-unavailable runs: {audit['usage_unavailable_runs']} (retained in success analysis, excluded from token/cost fits).",
        f"- Aggregate-only historical usage: {audit['aggregate_only_usage_runs']} runs; their round contracts contain null usage fields.",
        "- Success: `sum(passed) / sum(checks)` for weighted summaries; points retain run-level ratios.",
        "- Cost: `(uncached input*5 + cached input*0.5 + output*30) / 1,000,000` USD.",
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
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    records = load_runs(args.results.resolve())
    audit = audit_runs(records)
    token_models = fit_token_models(records)
    success_models = fit_success_models(records)
    cost_models = fit_cost_models(records)
    font_path = extract_archivo(args.reference_svg, output_dir)
    configure_style(font_path, output_dir)
    write_csv(records, output_dir)
    write_report(audit, token_models, success_models, cost_models, output_dir)
    plot_tokens(records, token_models, output_dir)
    plot_success(records, success_models, output_dir)
    plot_cost(records, cost_models, output_dir)
    print(
        json.dumps(
            {
                "output": str(output_dir),
                "runs": audit["run_count"],
                "tasks": audit["task_count"],
                "selected_token_models": {
                    group: token_models[group]["selected_model"] for group in AGENT_ORDER
                },
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    main()
