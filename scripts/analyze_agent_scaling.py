#!/usr/bin/env python3
"""Build run-level scaling charts from normalized benchmark contracts.

The script intentionally uses agent-rounds.jsonl as the common usage source
across benchmark generations. It verifies normalized summaries and recorded
costs where those fields exist, then exports reproducible data and diagnostics.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

import matplotlib.font_manager as font_manager
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter, MaxNLocator, PercentFormatter
from scipy.optimize import least_squares, minimize, nnls


BACKGROUND = "#f4f1ea"
INK = "#0a0a0a"
MUTED = "#474747"
GRID = "#dedbd2"
COLORS = {
    "tura-balanced": "#009f96",
    "tura-direct": "#df6b35",
    "codex-cli": "#7658a5",
}
LABELS = {
    "tura-balanced": "TURA BALANCED",
    "tura-direct": "TURA DIRECT",
    "codex-cli": "CODEX CLI",
}
GROUP_ORDER = tuple(COLORS)

# Existing task reports for both GPT-5.5 and GPT-5.6-SOL use these rates.
RATES_PER_MILLION = {"input": 5.0, "cached_input": 0.5, "output": 30.0}


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    category: str
    task: str
    agent_group: str
    model: str
    reasoning: str
    rounds: int
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float
    passed_checks: int
    total_checks: int
    success_rate: float
    rounds_path: str


@dataclass(frozen=True)
class CurveFit:
    name: str
    parameters: dict[str, float]
    r2: float
    rmse: float
    cv_rmse: float
    cv_nrmse: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--results-root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "results",
    )
    parser.add_argument(
        "--reference",
        type=Path,
        default=Path(r"C:\Users\liuliu\Documents\tura\assets\data\benchmark-agent-comparison.svg"),
    )
    parser.add_argument("--output-dir", type=Path)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def extract_archivo(reference: Path, output_dir: Path) -> Path | None:
    if not reference.exists():
        return None
    text = reference.read_text(encoding="utf-8")
    match = re.search(
        r"@font-face\{font-family:Archivo;src:url\(data:font/ttf;base64,([^\)]+)\)",
        text,
    )
    if not match:
        return None
    font_path = output_dir / "Archivo-Regular.ttf"
    font_path.write_bytes(base64.b64decode(match.group(1)))
    font_manager.fontManager.addfont(str(font_path))
    return font_path


def normalize_group(value: str, path: Path) -> str:
    haystack = f"{value} {path}".lower()
    if "tura-balanced" in haystack:
        return "tura-balanced"
    if "tura-direct" in haystack:
        return "tura-direct"
    if "codex" in haystack:
        return "codex-cli"
    raise ValueError(f"Unknown agent group for {path}: {value!r}")


def load_rounds(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rounds: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                rounds.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSON at {path}:{line_number}") from error
    if not rounds:
        raise ValueError(f"No rounds in {path}")
    return rounds, rounds[0].get("metadata", {})


def nested_number(document: dict[str, Any], *paths: tuple[str, ...]) -> float | None:
    for keys in paths:
        value: Any = document
        for key in keys:
            if not isinstance(value, dict) or key not in value:
                value = None
                break
            value = value[key]
        if isinstance(value, (int, float)):
            return float(value)
    return None


def compute_cost(input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    uncached_tokens = input_tokens - cached_tokens
    if uncached_tokens < 0:
        raise ValueError("Cached input tokens cannot exceed input tokens")
    return (
        uncached_tokens * RATES_PER_MILLION["input"]
        + cached_tokens * RATES_PER_MILLION["cached_input"]
        + output_tokens * RATES_PER_MILLION["output"]
    ) / 1_000_000


def load_records(results_root: Path) -> tuple[list[RunRecord], dict[str, Any]]:
    records: list[RunRecord] = []
    summary_round_deltas: list[float] = []
    summary_token_deltas: list[float] = []
    recorded_cost_deltas: list[float] = []

    rounds_paths = sorted(
        path
        for category in ("debug", "rewrite")
        for path in (results_root / category).rglob("agent-rounds.jsonl")
    )
    for rounds_path in rounds_paths:
        contracts_dir = rounds_path.parent
        metadata_dir = contracts_dir.parent
        harness_path = contracts_dir / "harness-report.json"
        task_report_path = contracts_dir / "task-report.json"
        summary_path = metadata_dir / "summary.json"
        if not harness_path.exists():
            raise FileNotFoundError(harness_path)

        rounds, first_metadata = load_rounds(rounds_path)
        harness = read_json(harness_path)
        task_report = read_json(task_report_path) if task_report_path.exists() else {}
        summary = read_json(summary_path) if summary_path.exists() else {}

        usage = [entry.get("usage", {}) for entry in rounds]
        input_tokens = sum(int(item.get("inputTokens") or 0) for item in usage)
        cached_tokens = sum(int(item.get("cacheInputTokens") or 0) for item in usage)
        output_tokens = sum(int(item.get("outputTokens") or 0) for item in usage)
        total_tokens = sum(int(item.get("totalTokens") or 0) for item in usage)
        if total_tokens != input_tokens + output_tokens:
            raise ValueError(f"Usage total mismatch in {rounds_path}")

        source_agent = str(
            first_metadata.get("sourceAgentId")
            or first_metadata.get("agentId")
            or harness.get("agentId")
            or task_report.get("agent")
            or ""
        )
        agent_group = normalize_group(source_agent, rounds_path)
        model = str(
            first_metadata.get("model")
            or task_report.get("source", {}).get("model")
            or summary.get("model")
            or "unknown"
        ).replace("openai/", "")
        reasoning = str(
            first_metadata.get("reasoning")
            or summary.get("effort")
            or summary.get("reasoning")
            or "unknown"
        )
        run_id = str(harness.get("runId") or task_report.get("runId") or metadata_dir.parent.name)
        task = str(
            first_metadata.get("taskId")
            or harness.get("taskId")
            or task_report.get("task")
            or "unknown"
        )
        category = str(harness.get("category") or task_report.get("category") or rounds_path.parts[-8])

        score = harness.get("score", {})
        passed = int(score.get("passed") or 0)
        checks = int(score.get("total") or 0)
        if checks <= 0 or passed < 0 or passed > checks:
            raise ValueError(f"Invalid harness score in {harness_path}")

        cost_usd = compute_cost(input_tokens, cached_tokens, output_tokens)
        recorded_cost = nested_number(
            task_report,
            ("source", "costUsd"),
            ("source", "cost", "costUsd"),
            ("source", "pricing", "costUsd"),
        )
        if recorded_cost is not None:
            recorded_cost_deltas.append(abs(cost_usd - recorded_cost))

        summary_rounds = nested_number(summary, ("events", "rounds"))
        summary_tokens = nested_number(summary, ("usage", "totalTokens"))
        if summary_rounds is not None:
            summary_round_deltas.append(abs(len(rounds) - summary_rounds))
        if summary_tokens is not None:
            summary_token_deltas.append(abs(total_tokens - summary_tokens))

        records.append(
            RunRecord(
                run_id=run_id,
                category=category,
                task=task,
                agent_group=agent_group,
                model=model,
                reasoning=reasoning,
                rounds=len(rounds),
                input_tokens=input_tokens,
                cached_input_tokens=cached_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                cost_usd=cost_usd,
                passed_checks=passed,
                total_checks=checks,
                success_rate=passed / checks,
                rounds_path=str(rounds_path.resolve()),
            )
        )

    validation = {
        "round_files": len(rounds_paths),
        "normalized_summary_round_comparisons": len(summary_round_deltas),
        "max_summary_round_delta": max(summary_round_deltas, default=0),
        "normalized_summary_token_comparisons": len(summary_token_deltas),
        "max_summary_token_delta": max(summary_token_deltas, default=0),
        "recorded_cost_comparisons": len(recorded_cost_deltas),
        "max_recorded_cost_delta_usd": max(recorded_cost_deltas, default=0),
    }
    return records, validation


def r2_rmse(actual: np.ndarray, predicted: np.ndarray) -> tuple[float, float]:
    residual = actual - predicted
    rmse = float(np.sqrt(np.mean(residual**2)))
    denominator = float(np.sum((actual - np.mean(actual)) ** 2))
    r2 = 1.0 - float(np.sum(residual**2)) / denominator if denominator else float("nan")
    return r2, rmse


def quadratic_estimator(x: np.ndarray, y: np.ndarray) -> tuple[dict[str, float], Callable[[np.ndarray], np.ndarray]]:
    design = np.column_stack((x, x * (x + 1.0) / 2.0))
    coefficients, _ = nnls(design, y)
    base, growth = (float(value) for value in coefficients)
    return {"B": base, "c": growth}, lambda values: base * values + growth * values * (values + 1.0) / 2.0


def power_estimator(x: np.ndarray, y: np.ndarray) -> tuple[dict[str, float], Callable[[np.ndarray], np.ndarray]]:
    log_x = np.log(x)
    log_y = np.log(y)
    initial_p, initial_log_k = np.polyfit(log_x, log_y, 1)
    result = least_squares(
        lambda values: np.exp(values[0]) * x ** values[1] - y,
        x0=np.array([initial_log_k, initial_p]),
        bounds=(np.array([-20.0, 0.25]), np.array([30.0, 3.0])),
        max_nfev=20_000,
    )
    k = float(np.exp(result.x[0]))
    p = float(result.x[1])
    return {"K": k, "p": p}, lambda values: k * values**p


def cross_validated_rmse(
    x: np.ndarray,
    y: np.ndarray,
    estimator: Callable[[np.ndarray, np.ndarray], tuple[dict[str, float], Callable[[np.ndarray], np.ndarray]]],
) -> float:
    random = np.random.default_rng(20260714)
    indices = random.permutation(len(x))
    folds = np.array_split(indices, 5)
    predictions = np.zeros_like(y, dtype=float)
    for test_indices in folds:
        train_mask = np.ones(len(x), dtype=bool)
        train_mask[test_indices] = False
        _, predict = estimator(x[train_mask], y[train_mask])
        predictions[test_indices] = predict(x[test_indices])
    return float(np.sqrt(np.mean((y - predictions) ** 2)))


def fit_curve(x: np.ndarray, y: np.ndarray, name: str) -> tuple[CurveFit, Callable[[np.ndarray], np.ndarray]]:
    estimator = quadratic_estimator if name == "quadratic" else power_estimator
    parameters, predict = estimator(x, y)
    r2, rmse = r2_rmse(y, predict(x))
    cv_rmse = cross_validated_rmse(x, y, estimator)
    return (
        CurveFit(
            name=name,
            parameters=parameters,
            r2=r2,
            rmse=rmse,
            cv_rmse=cv_rmse,
            cv_nrmse=cv_rmse / float(np.mean(y)),
        ),
        predict,
    )


def fit_token_growth(records: list[RunRecord]) -> tuple[dict[str, Any], dict[str, Callable[[np.ndarray], np.ndarray]]]:
    report: dict[str, Any] = {}
    predictors: dict[str, Callable[[np.ndarray], np.ndarray]] = {}
    for group in GROUP_ORDER:
        subset = [record for record in records if record.agent_group == group]
        x = np.array([record.rounds for record in subset], dtype=float)
        y = np.array([record.total_tokens for record in subset], dtype=float)
        quadratic, quadratic_predict = fit_curve(x, y, "quadratic")
        power, power_predict = fit_curve(x, y, "power")

        quadratic_supported = quadratic.r2 >= 0.70 and quadratic.cv_nrmse <= 0.35
        power_materially_better = power.cv_rmse < quadratic.cv_rmse * 0.95
        selected = power if power_materially_better else quadratic
        selected_predict = power_predict if power_materially_better else quadratic_predict
        conforms = quadratic_supported and not power_materially_better

        report[group] = {
            "runs": len(subset),
            "quadratic_hypothesis": asdict(quadratic),
            "power_alternative": asdict(power),
            "selected_model": selected.name,
            "conforms_to_hypothesis": conforms,
            "decision_rule": "quadratic requires R2 >= 0.70 and 5-fold CV NRMSE <= 0.35; power replaces it when CV RMSE improves by >5%",
        }
        predictors[group] = selected_predict
    return report, predictors


def fit_cost_curves(records: list[RunRecord]) -> dict[str, Callable[[np.ndarray], np.ndarray]]:
    predictors: dict[str, Callable[[np.ndarray], np.ndarray]] = {}
    for group in GROUP_ORDER:
        subset = [record for record in records if record.agent_group == group]
        x = np.array([record.rounds for record in subset], dtype=float)
        y = np.array([record.cost_usd for record in subset], dtype=float)
        _, predictors[group] = fit_curve(x, y, "power")
    return predictors


def logistic_predict(design: np.ndarray, coefficients: np.ndarray) -> np.ndarray:
    linear = np.clip(design @ coefficients, -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-linear))


def fit_success_curve(records: list[RunRecord], group: str) -> tuple[Callable[[np.ndarray], np.ndarray], dict[str, Any]]:
    subset = [record for record in records if record.agent_group == group]
    x = np.log1p(np.array([record.rounds for record in subset], dtype=float))
    passed = np.array([record.passed_checks for record in subset], dtype=float)
    totals = np.array([record.total_checks for record in subset], dtype=float)

    candidates: list[tuple[float, int, np.ndarray]] = []
    for degree in (1, 2):
        design = np.column_stack([x**power for power in range(degree + 1)])

        def objective(coefficients: np.ndarray) -> float:
            probabilities = np.clip(logistic_predict(design, coefficients), 1e-9, 1.0 - 1e-9)
            return float(-np.sum(passed * np.log(probabilities) + (totals - passed) * np.log(1.0 - probabilities)))

        result = minimize(objective, np.zeros(degree + 1), method="BFGS")
        nll = objective(result.x)
        bic = 2.0 * nll + (degree + 1) * math.log(float(np.sum(totals)))
        candidates.append((bic, degree, result.x))

    bic, degree, coefficients = min(candidates, key=lambda item: item[0])

    def predict(values: np.ndarray) -> np.ndarray:
        transformed = np.log1p(values)
        design = np.column_stack([transformed**power for power in range(degree + 1)])
        return logistic_predict(design, coefficients)

    return predict, {
        "degree": degree,
        "coefficients": [float(value) for value in coefficients],
        "bic": float(bic),
        "weighted_success_rate": float(np.sum(passed) / np.sum(totals)),
    }


def style_axes(axis: plt.Axes) -> None:
    axis.set_facecolor(BACKGROUND)
    axis.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    axis.spines[["top", "right", "left"]].set_visible(False)
    axis.spines["bottom"].set_color(MUTED)
    axis.spines["bottom"].set_linewidth(0.7)
    axis.tick_params(colors=MUTED, labelsize=9, length=0, pad=7)
    axis.xaxis.set_major_locator(MaxNLocator(nbins=7, integer=True))


def add_header(figure: plt.Figure, title: str, subtitle: str, meta: str) -> None:
    figure.text(0.09, 0.955, title, fontsize=21, fontweight=700, color=INK, va="top")
    figure.text(0.09, 0.905, subtitle, fontsize=10.5, color=MUTED, va="top")
    figure.text(0.91, 0.955, meta, fontsize=8.5, color=MUTED, va="top", ha="right")
    figure.add_artist(plt.Line2D([0.09, 0.91], [0.875, 0.875], color=INK, linewidth=1.0))


def add_group_legend(axis: plt.Axes) -> None:
    handles = [
        plt.Line2D([], [], color=COLORS[group], marker="o", markersize=5, linewidth=2.0, label=LABELS[group])
        for group in GROUP_ORDER
    ]
    axis.legend(
        handles=handles,
        loc="upper left",
        bbox_to_anchor=(0.0, 1.02),
        ncol=3,
        frameon=False,
        fontsize=8.5,
        handlelength=2.4,
        columnspacing=1.6,
        borderaxespad=0,
    )


def scatter_and_lines(
    axis: plt.Axes,
    records: list[RunRecord],
    y_getter: Callable[[RunRecord], float],
    predictors: dict[str, Callable[[np.ndarray], np.ndarray]],
) -> None:
    for group in GROUP_ORDER:
        subset = [record for record in records if record.agent_group == group]
        x = np.array([record.rounds for record in subset], dtype=float)
        y = np.array([y_getter(record) for record in subset], dtype=float)
        axis.scatter(
            x,
            y,
            s=20,
            facecolors=BACKGROUND,
            edgecolors=COLORS[group],
            linewidths=0.85,
            alpha=0.72,
            zorder=2,
        )
        curve_x = np.linspace(max(1.0, float(np.min(x))), float(np.max(x)), 240)
        axis.plot(curve_x, predictors[group](curve_x), color=COLORS[group], linewidth=2.4, zorder=3)


def save_figure(figure: plt.Figure, output_dir: Path, stem: str) -> None:
    for suffix in ("png", "svg"):
        figure.savefig(
            output_dir / f"{stem}.{suffix}",
            dpi=220 if suffix == "png" else None,
            facecolor=BACKGROUND,
            bbox_inches="tight",
        )
    plt.close(figure)


def chart_token_growth(
    records: list[RunRecord],
    predictors: dict[str, Callable[[np.ndarray], np.ndarray]],
    fits: dict[str, Any],
    output_dir: Path,
) -> None:
    figure, axis = plt.subplots(figsize=(8, 7.2), facecolor=BACKGROUND)
    figure.subplots_adjust(left=0.12, right=0.91, bottom=0.13, top=0.80)
    add_header(
        figure,
        "TOKEN GROWTH BY AGENT GROUP",
        "Each mark is one run; model configurations and tasks are pooled within the same agent-group curve.",
        "270 RUNS  /  25 TASKS",
    )
    style_axes(axis)
    scatter_and_lines(axis, records, lambda record: record.total_tokens / 1_000_000, {
        group: (lambda values, predictor=predictors[group]: predictor(values) / 1_000_000)
        for group in GROUP_ORDER
    })
    axis.set_xlabel("AGENT ROUNDS", fontsize=9, fontweight=700, color=INK, labelpad=12)
    axis.set_ylabel("TOTAL TOKENS  ·  MILLIONS", fontsize=9, fontweight=700, color=INK, labelpad=12)
    axis.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:.0f}M"))
    add_group_legend(axis)

    verdicts = []
    for group in GROUP_ORDER:
        result = fits[group]
        selected = result["selected_model"]
        if result["conforms_to_hypothesis"]:
            verdicts.append(f"{LABELS[group]}: QUADRATIC SUPPORTED")
        else:
            power = result["power_alternative"]["parameters"]
            verdicts.append(f"{LABELS[group]}: K·n^{power['p']:.2f} SELECTED ({selected.upper()})")
    figure.text(0.09, 0.045, "  ·  ".join(verdicts), fontsize=7.5, color=MUTED, va="bottom")
    save_figure(figure, output_dir, "01-token-growth-vs-rounds")


def chart_success(records: list[RunRecord], output_dir: Path) -> dict[str, Any]:
    predictors: dict[str, Callable[[np.ndarray], np.ndarray]] = {}
    diagnostics: dict[str, Any] = {}
    for group in GROUP_ORDER:
        predictors[group], diagnostics[group] = fit_success_curve(records, group)

    figure, axis = plt.subplots(figsize=(8, 7.2), facecolor=BACKGROUND)
    figure.subplots_adjust(left=0.12, right=0.91, bottom=0.13, top=0.80)
    add_header(
        figure,
        "SUCCESS RATE VS. AGENT ROUNDS",
        "Run-level harness outcomes with check-weighted binomial trend lines; association is not causation.",
        "3,310 / 4,424 CHECKS",
    )
    style_axes(axis)
    scatter_and_lines(axis, records, lambda record: record.success_rate, predictors)
    axis.set_xlabel("AGENT ROUNDS", fontsize=9, fontweight=700, color=INK, labelpad=12)
    axis.set_ylabel("HARNESS SUCCESS RATE", fontsize=9, fontweight=700, color=INK, labelpad=12)
    axis.set_ylim(-0.04, 1.04)
    axis.yaxis.set_major_formatter(PercentFormatter(xmax=1.0, decimals=0))
    add_group_legend(axis)
    figure.text(
        0.09,
        0.045,
        "METHOD  ·  SUCCESS = Σ PASSED CHECKS / Σ TOTAL CHECKS  ·  CURVES = BIC-SELECTED LOGISTIC FITS",
        fontsize=7.5,
        color=MUTED,
        va="bottom",
    )
    save_figure(figure, output_dir, "02-success-rate-vs-rounds")
    return diagnostics


def chart_cost(records: list[RunRecord], output_dir: Path) -> None:
    predictors = fit_cost_curves(records)
    figure, axis = plt.subplots(figsize=(8, 7.2), facecolor=BACKGROUND)
    figure.subplots_adjust(left=0.12, right=0.91, bottom=0.13, top=0.80)
    add_header(
        figure,
        "TOKEN COST VS. AGENT ROUNDS",
        "Standardized run cost from uncached input, cached input, and output usage; each mark is one run.",
        "USD  /  STANDARD TIER",
    )
    style_axes(axis)
    scatter_and_lines(axis, records, lambda record: record.cost_usd, predictors)
    axis.set_xlabel("AGENT ROUNDS", fontsize=9, fontweight=700, color=INK, labelpad=12)
    axis.set_ylabel("TOKEN COST  ·  USD", fontsize=9, fontweight=700, color=INK, labelpad=12)
    axis.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"${value:,.0f}"))
    add_group_legend(axis)
    figure.text(
        0.09,
        0.045,
        "RATES / 1M TOKENS  ·  UNCACHED INPUT $5.00  ·  CACHED INPUT $0.50  ·  OUTPUT $30.00",
        fontsize=7.5,
        color=MUTED,
        va="bottom",
    )
    save_figure(figure, output_dir, "03-token-cost-vs-rounds")


def export_csv(records: list[RunRecord], output_dir: Path) -> None:
    path = output_dir / "run-level-data.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(asdict(records[0]).keys()))
        writer.writeheader()
        for record in records:
            writer.writerow(asdict(record))


def write_summary(
    records: list[RunRecord],
    validation: dict[str, Any],
    growth_fits: dict[str, Any],
    success_fits: dict[str, Any],
    output_dir: Path,
) -> None:
    totals = {
        "runs": len(records),
        "tasks": len({record.task for record in records}),
        "rounds": sum(record.rounds for record in records),
        "tokens": sum(record.total_tokens for record in records),
        "cost_usd": sum(record.cost_usd for record in records),
        "passed_checks": sum(record.passed_checks for record in records),
        "total_checks": sum(record.total_checks for record in records),
    }
    report = {
        "source": {
            "results_root": str(Path(records[0].rounds_path).parents[7]),
            "grain": "one row per benchmark run",
            "usage_source": "metadata/contracts/agent-rounds.jsonl",
            "success_source": "metadata/contracts/harness-report.json",
            "cost_formula": "((input-cached)*5 + cached*0.5 + output*30) / 1,000,000 USD",
        },
        "totals": totals,
        "validation": validation,
        "token_growth": growth_fits,
        "success_models": success_fits,
    }
    (output_dir / "fit-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    lines = [
        "# 回合数、Token 与成功率分析",
        "",
        "## 数据口径",
        "",
        f"- {totals['runs']} 个 run，{totals['tasks']} 个任务，按 agentgroup 合并不同模型配置与任务。",
        f"- 总回合数：{totals['rounds']:,}；总 token：{totals['tokens'] / 1_000_000:.1f}M。",
        f"- 成功率：{totals['passed_checks']:,}/{totals['total_checks']:,} = {totals['passed_checks'] / totals['total_checks']:.1%}（检查数加权）。",
        "- 每个 run 的回合与 token 来自 `agent-rounds.jsonl`；成功检查数来自 `harness-report.json`。",
        "- Token 成本按每百万 token：未缓存输入 $5.00、缓存输入 $0.50、输出 $30.00 重算。",
        "",
        "## 公式检验",
        "",
        "给定单回合增量 `B + i c` 时，正确求和是：",
        "",
        "`T(n) = Σ(B + i c) = nB + c n(n+1)/2`。",
        "",
        "原式若写成 `nB + 2c n(n+1)`，系数不正确；应为 `c/2`。检验采用非负最小二乘，并与 `T(n)=K n^p` 做固定 5 折交叉验证。",
        "",
    ]
    for group in GROUP_ORDER:
        result = growth_fits[group]
        quadratic = result["quadratic_hypothesis"]
        power = result["power_alternative"]
        q_parameters = quadratic["parameters"]
        p_parameters = power["parameters"]
        verdict = "支持二次假设" if result["conforms_to_hypothesis"] else "不支持统一二次假设"
        lines.extend(
            [
                f"### {LABELS[group]}",
                "",
                f"- 结论：{verdict}；图中采用 `{result['selected_model']}` 趋势。",
                f"- 二次式：`B={q_parameters['B']:.1f}`，`c={q_parameters['c']:.1f}`；R²={quadratic['r2']:.3f}，CV NRMSE={quadratic['cv_nrmse']:.3f}。",
                f"- 幂律替代：`T(n)={p_parameters['K']:.1f} n^{p_parameters['p']:.3f}`；R²={power['r2']:.3f}，CV NRMSE={power['cv_nrmse']:.3f}。",
                "",
            ]
        )
    lines.extend(
        [
            "## 解释限制",
            "",
            "这些点是跨任务的横截面 run，不是同一个任务无限延长的实验。任务难度、上下文压缩、模型配置和工具输出共同影响 token，因此趋势只能说明关联，不能单独证明回合数造成成功率变化。",
        ]
    )
    (output_dir / "analysis-summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def validate_outputs(records: list[RunRecord], validation: dict[str, Any], output_dir: Path) -> None:
    expected = {
        "01-token-growth-vs-rounds.png",
        "01-token-growth-vs-rounds.svg",
        "02-success-rate-vs-rounds.png",
        "02-success-rate-vs-rounds.svg",
        "03-token-cost-vs-rounds.png",
        "03-token-cost-vs-rounds.svg",
        "run-level-data.csv",
        "fit-report.json",
        "analysis-summary.md",
    }
    missing = [name for name in expected if not (output_dir / name).exists()]
    if missing:
        raise RuntimeError(f"Missing outputs: {missing}")
    if len(records) != 270:
        raise RuntimeError(f"Expected 270 benchmark runs, found {len(records)}")
    if {record.agent_group for record in records} != set(GROUP_ORDER):
        raise RuntimeError("Unexpected agent-group coverage")
    if any(sum(record.agent_group == group for record in records) != 90 for group in GROUP_ORDER):
        raise RuntimeError("Each agent group must contain 90 runs")
    if validation["max_summary_round_delta"] != 0 or validation["max_summary_token_delta"] != 0:
        raise RuntimeError("Round-derived usage disagrees with normalized summaries")
    if validation["max_recorded_cost_delta_usd"] > 1e-6:
        raise RuntimeError("Recomputed cost disagrees with recorded task reports")


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir or args.reference.parent / "generated-statistics"
    output_dir.mkdir(parents=True, exist_ok=True)
    font_path = extract_archivo(args.reference, output_dir)
    plt.rcParams.update(
        {
            "font.family": "Archivo" if font_path else "DejaVu Sans",
            "font.size": 10,
            "axes.unicode_minus": False,
            "svg.fonttype": "none",
        }
    )

    records, validation = load_records(args.results_root)
    records.sort(key=lambda record: (GROUP_ORDER.index(record.agent_group), record.rounds, record.task, record.run_id))
    growth_fits, growth_predictors = fit_token_growth(records)
    chart_token_growth(records, growth_predictors, growth_fits, output_dir)
    success_fits = chart_success(records, output_dir)
    chart_cost(records, output_dir)
    export_csv(records, output_dir)
    write_summary(records, validation, growth_fits, success_fits, output_dir)
    validate_outputs(records, validation, output_dir)

    print(
        json.dumps(
            {
                "output_dir": str(output_dir.resolve()),
                "runs": len(records),
                "rounds": sum(record.rounds for record in records),
                "tokens": sum(record.total_tokens for record in records),
                "checks": f"{sum(record.passed_checks for record in records)}/{sum(record.total_checks for record in records)}",
                "growth_models": {group: growth_fits[group]["selected_model"] for group in GROUP_ORDER},
                "validation": validation,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
