#!/usr/bin/env python3
"""Render five claim-focused charts from the filtered model-run analysis."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import textwrap
from collections import defaultdict
from pathlib import Path
from typing import Iterable

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.font_manager import FontProperties, fontManager
from scipy.optimize import minimize
from scipy.special import expit
from scipy.stats import norm

from analysis_config import configured_path, load_analysis_config, repository_path


ANALYSIS_CONFIG = load_analysis_config()
AGENT_ORDER = tuple(ANALYSIS_CONFIG["configurations"])
TURA_GROUPS = tuple(group for group in AGENT_ORDER if group.startswith("tura-"))
LABELS = {
    "tura-balanced": "Tura Balanced",
    "tura-direct": "Tura Direct",
    "codex-cli-medium": "Codex Medium",
    "codex-cli-high": "Codex High",
}
COLORS = {
    "tura-balanced": "#008f87",
    "tura-direct": "#d56538",
    "codex-cli-medium": "#6b5fb5",
    "codex-cli-high": "#3978a8",
}
BACKGROUND = "#f4f1ea"
INK = "#0a0a0a"
MUTED = "#474747"
GRID = "#dedbd2"
COMPONENT_COLORS = {
    "uncached_input": "#d56538",
    "cached_input": "#008f87",
    "output": "#6b5fb5",
}
PRICE = dict(ANALYSIS_CONFIG["pricingUsdPer1mTokens"])


def analysis_sample_note(config: dict) -> str:
    population = config["population"]
    rounds = " and ".join(
        str(item["rounds"]) for item in config["relationshipExclusions"]
    )
    return (
        f"SAMPLE · {population['relationshipRuns']} runs / {population['tasks']} tasks. "
        f"Excluded from figures: {len(config['relationshipExclusions'])} configured "
        f"long-tail runs ({rounds} rounds); retained in published aggregates."
    )


ANALYSIS_SAMPLE_NOTE = analysis_sample_note(ANALYSIS_CONFIG)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config/analysis.json"))
    parser.add_argument(
        "--input",
        type=Path,
    )
    parser.add_argument(
        "--output",
        type=Path,
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def extract_command_count(row: dict, results_root: Path) -> tuple[int, str]:
    source_path = Path(row["source_path"])
    if not source_path.is_absolute():
        source_path = results_root / source_path
    contract_dir = source_path.parent
    metadata_dir = contract_dir.parent
    summary = load_json(metadata_dir / "summary.json")
    task_report = load_json(contract_dir / "task-report.json")

    summary_commands = (summary.get("events") or {}).get("commands")
    if summary_commands is not None:
        return int(summary_commands), "summary.events.commands"

    task_commands = (task_report.get("source") or {}).get("commands")
    if task_commands is not None:
        return int(task_commands), "task-report.source.commands"

    rounds_path = contract_dir / "agent-rounds.jsonl"
    if not rounds_path.exists():
        raise ValueError(f"No command-count source for {row['run_id']}")
    round_records = [
        json.loads(line)
        for line in rounds_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    count = sum(
        len(record.get("commands") or record.get("toolCalls") or [])
        for record in round_records
    )
    return count, "agent-rounds.commands[]"


def load_rows(path: Path, results_root: Path, expected_runs: int) -> list[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        raw = list(csv.DictReader(handle))
    rows: list[dict] = []
    for item in raw:
        row = dict(item)
        for key in (
            "rounds",
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "total_tokens",
            "passed",
            "checks",
        ):
            row[key] = int(row[key])
        for key in ("success_rate", "cost_usd"):
            row[key] = float(row[key])
        row["commands"], row["command_count_source"] = extract_command_count(
            row, results_root
        )
        rows.append(row)
    if len(rows) != expected_runs:
        raise ValueError(f"Expected {expected_runs} analysis runs, found {len(rows)}")
    if len({row["source_path"] for row in rows}) != len(rows):
        raise ValueError("Duplicate run source paths")
    if any(row["commands"] <= 0 for row in rows if row["agent_group"] in TURA_GROUPS):
        raise ValueError("Tura command-success charts require positive command counts")
    return rows


def group_rows(rows: Iterable[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["agent_group"]].append(row)
    if set(groups) != set(AGENT_ORDER):
        raise ValueError(f"Unexpected agent groups: {sorted(groups)}")
    return groups


def weighted_success(rows: Iterable[dict]) -> float:
    rows = list(rows)
    return sum(row["passed"] for row in rows) / sum(row["checks"] for row in rows)


def aggregate_summary(groups: dict[str, list[dict]]) -> dict[str, dict]:
    summary: dict[str, dict] = {}
    for group in AGENT_ORDER:
        rows = groups[group]
        rounds = np.array([row["rounds"] for row in rows], dtype=float)
        costs = np.array([row["cost_usd"] for row in rows], dtype=float)
        summary[group] = {
            "runs": len(rows),
            "mean_rounds": float(np.mean(rounds)),
            "median_rounds": float(np.median(rounds)),
            "mean_cost_usd": float(np.mean(costs)),
            "success_rate": weighted_success(rows),
            "checks": sum(row["checks"] for row in rows),
        }
    return summary


def configure_style(regular: Path, bold: Path) -> str:
    for path in (regular, bold):
        if path.exists():
            fontManager.addfont(str(path))
    family = FontProperties(fname=str(regular)).get_name() if regular.exists() else "Arial"
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
            "mathtext.fontset": "dejavusans",
            "mathtext.default": "regular",
            "svg.fonttype": "path",
        }
    )
    return family


def new_figure(kicker: str, title: str, subtitle: str) -> tuple[plt.Figure, plt.Axes]:
    figure, axis = plt.subplots(figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(left=0.11, right=0.95, bottom=0.19, top=0.72)
    figure.text(0.11, 0.93, kicker.upper(), color=MUTED, fontsize=10, weight="bold")
    figure.text(0.11, 0.855, title, color=INK, fontsize=28, weight="bold")
    figure.text(0.11, 0.795, subtitle, color=MUTED, fontsize=12)
    figure.add_artist(
        mpl.lines.Line2D(
            [0.11, 0.95],
            [0.755, 0.755],
            transform=figure.transFigure,
            color=GRID,
            linewidth=0.7,
        )
    )
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["left", "bottom"]].set_color(GRID)
    axis.tick_params(length=0, pad=8)
    axis.grid(axis="y")
    axis.grid(axis="x", alpha=0.4)
    return figure, axis


def new_panel_figure(
    kicker: str,
    title: str,
    subtitle: str,
    rows: int,
    columns: int,
) -> tuple[plt.Figure, np.ndarray]:
    figure, axes = plt.subplots(rows, columns, figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(
        left=0.09,
        right=0.95,
        bottom=0.19,
        top=0.70,
        hspace=0.34,
        wspace=0.20,
    )
    figure.text(0.08, 0.93, kicker.upper(), color=MUTED, fontsize=10, weight="bold")
    figure.text(0.08, 0.855, title, color=INK, fontsize=28, weight="bold")
    figure.text(0.08, 0.795, subtitle, color=MUTED, fontsize=12)
    figure.add_artist(
        mpl.lines.Line2D(
            [0.08, 0.95],
            [0.755, 0.755],
            transform=figure.transFigure,
            color=GRID,
            linewidth=0.7,
        )
    )
    axes_array = np.atleast_1d(axes).ravel()
    for axis in axes_array:
        axis.spines[["top", "right"]].set_visible(False)
        axis.spines[["left", "bottom"]].set_color(GRID)
        axis.tick_params(length=0, pad=7)
        axis.grid(axis="y")
        axis.grid(axis="x", alpha=0.35)
    return figure, axes_array


def add_figure_notes(figure: plt.Figure, method_note: str, left: float = 0.08) -> None:
    figure.text(
        left,
        0.080,
        textwrap.fill(method_note, width=126),
        color=MUTED,
        fontsize=8.4,
        linespacing=1.25,
    )
    figure.text(
        left,
        0.030,
        textwrap.fill(ANALYSIS_SAMPLE_NOTE, width=132),
        color=MUTED,
        fontsize=8.1,
        linespacing=1.20,
    )


def save(figure: plt.Figure, output_dir: Path, stem: str) -> None:
    figure.savefig(output_dir / f"{stem}.png", dpi=200, pad_inches=0.08)
    figure.savefig(output_dir / f"{stem}.svg", pad_inches=0.08)
    plt.close(figure)


def stable_jitter(run_id: str, width: float) -> float:
    digest = hashlib.sha256(run_id.encode("utf-8")).digest()
    return ((int.from_bytes(digest[:2], "big") / 65535.0) - 0.5) * width


def fit_success_association(rows: list[dict], metric: str) -> dict[str, float | str]:
    values = np.array([row[metric] for row in rows], dtype=float)
    predictor = np.log1p(values)
    passed = np.array([row["passed"] for row in rows], dtype=float)
    checks = np.array([row["checks"] for row in rows], dtype=float)

    def objective(params: np.ndarray) -> float:
        logits = params[0] + params[1] * predictor
        return float(np.sum(checks * np.logaddexp(0, logits) - passed * logits))

    base_rate = np.clip(np.sum(passed) / np.sum(checks), 1e-6, 1 - 1e-6)
    initial = np.array([math.log(base_rate / (1 - base_rate)), 0.0])
    result = minimize(objective, initial, method="BFGS")
    if not result.success and np.linalg.norm(result.jac) > 1e-4:
        raise RuntimeError(f"Success fit failed for {metric}: {result.message}")

    alpha, beta = result.x
    fitted = expit(alpha + beta * predictor)
    design = np.column_stack((np.ones(len(rows)), predictor))
    weights = checks * fitted * (1 - fitted)
    covariance = np.linalg.inv(design.T @ (weights[:, None] * design))
    beta_se = float(np.sqrt(covariance[1, 1]))
    beta_p_value = float(2 * norm.sf(abs(beta / beta_se)))
    q1, q3 = np.quantile(values, [0.25, 0.75])
    q_design = np.column_stack((np.ones(2), np.log1p([q1, q3])))
    q1_probability, q3_probability = expit(q_design @ np.array([alpha, beta]))
    contrast_gradient = (
        q3_probability * (1 - q3_probability) * q_design[1]
        - q1_probability * (1 - q1_probability) * q_design[0]
    )
    contrast_standard_error = float(
        np.sqrt(contrast_gradient @ covariance @ contrast_gradient)
    )
    contrast = float(q3_probability - q1_probability)
    critical = float(norm.ppf(0.975))
    return {
        "formula": f"logit(P(success)) = alpha + beta*log(1+{metric})",
        "alpha": float(alpha),
        "beta": float(beta),
        "beta_standard_error": beta_se,
        "beta_p_value_naive": beta_p_value,
        "q1": float(q1),
        "q3": float(q3),
        "q1_success_percent": float(q1_probability * 100),
        "q3_success_percent": float(q3_probability * 100),
        "interquartile_fitted_probability_change_percentage_points": float(
            contrast * 100
        ),
        "interquartile_fitted_probability_change_95_ci_percentage_points_model_based": [
            float((contrast - critical * contrast_standard_error) * 100),
            float((contrast + critical * contrast_standard_error) * 100),
        ],
        "observed_min": float(np.min(values)),
        "observed_max": float(np.max(values)),
    }


def plot_success_panel(
    axis: plt.Axes,
    rows: list[dict],
    group: str,
    metric: str,
    model: dict[str, float | str],
    xlabel: str,
) -> None:
    values = np.array([row[metric] for row in rows], dtype=float)
    rates = np.array([row["success_rate"] for row in rows], dtype=float) * 100
    checks = np.array([row["checks"] for row in rows], dtype=float)
    jittered = np.array(
        [
            np.clip(rate + stable_jitter(row["run_id"], 2.4), 0, 100)
            for row, rate in zip(rows, rates)
        ]
    )
    axis.scatter(
        values,
        jittered,
        s=14 + 3.5 * np.sqrt(checks),
        color=COLORS[group],
        alpha=0.23,
        linewidth=0,
        zorder=2,
    )
    x_line = np.linspace(float(np.min(values)), float(np.max(values)), 300)
    y_line = expit(
        float(model["alpha"]) + float(model["beta"]) * np.log1p(x_line)
    ) * 100
    axis.plot(x_line, y_line, color=COLORS[group], linewidth=2.6, zorder=3)
    axis.set_title(
        f"{LABELS[group]} · n={len(rows)}",
        loc="left",
        fontsize=11,
        weight="bold",
        pad=9,
    )
    contrast_low, contrast_high = model[
        "interquartile_fitted_probability_change_95_ci_percentage_points_model_based"
    ]
    axis.text(
        0.965,
        0.075,
        f"Q1 → Q3: {float(model['q1']):g} → {float(model['q3']):g}\n"
        f"Fitted success: "
        f"{float(model['interquartile_fitted_probability_change_percentage_points']):+.1f} pp "
        f"[{float(contrast_low):+.1f}, {float(contrast_high):+.1f}]",
        transform=axis.transAxes,
        ha="right",
        va="bottom",
        fontsize=8.0,
        color=INK,
        bbox={
            "boxstyle": "round,pad=0.34,rounding_size=0.08",
            "facecolor": BACKGROUND,
            "edgecolor": GRID,
            "linewidth": 0.6,
            "alpha": 0.94,
        },
        zorder=5,
    )
    axis.set_xlim(0, float(np.max(values)) * 1.05)
    axis.set_ylim(-2, 102)
    axis.set_xlabel(xlabel)
    axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))


def plot_rounds_not_efficiency(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axis = new_figure(
        "Descriptive relationship 1 · command batching",
        "Recorded command count by agent-round count",
        "Points are runs; lines are ordinary least-squares summaries within each configuration.",
    )
    models: dict[str, dict] = {}
    for group in AGENT_ORDER:
        rows = groups[group]
        rounds = np.array([row["rounds"] for row in rows], dtype=float)
        commands = np.array([row["commands"] for row in rows], dtype=float)
        slope, intercept = np.polyfit(rounds, commands, 1)
        models[group] = {
            "mean_commands_per_round": float(np.sum(commands) / np.sum(rounds)),
            "median_commands_per_round": float(np.median(commands / rounds)),
            "linear_slope": float(slope),
            "linear_intercept": float(intercept),
        }
        axis.scatter(rounds, commands, s=24, color=COLORS[group], alpha=0.24, linewidth=0)
        x_line = np.linspace(float(np.min(rounds)), float(np.max(rounds)), 200)
        axis.plot(
            x_line,
            np.maximum(0, intercept + slope * x_line),
            color=COLORS[group],
            linewidth=2.4,
            label=(
                f"{LABELS[group]} · sum(commands)/sum(rounds) = "
                f"{models[group]['mean_commands_per_round']:.2f}"
            ),
        )
    axis.set_xlim(left=0)
    axis.set_ylim(bottom=0)
    axis.set_xlabel("Agent rounds")
    axis.set_ylabel("Recorded command count")
    axis.legend(loc="upper left", frameon=False, fontsize=8.8, ncols=2)
    add_figure_notes(
        figure,
        "ESTIMAND · OLS command-count trend by configuration; legend ratio is sum(commands)/sum(rounds). Tura and Codex command units are not atomically equivalent.",
        left=0.11,
    )
    save(figure, output_dir, "04-rounds-vs-commands")
    return models


def plot_cost_success_frontier(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Descriptive relationship 2 · weighted binomial regression",
        "Round count and fitted success probability",
        "Separate models by configuration; predictor = log(1 + agent rounds).",
        2,
        2,
    )
    figure.subplots_adjust(
        left=0.09,
        right=0.96,
        bottom=0.19,
        top=0.70,
        hspace=0.28,
        wspace=0.18,
    )
    models: dict[str, dict] = {}
    for axis, group in zip(axes, AGENT_ORDER):
        models[group] = fit_success_association(groups[group], "rounds")
        plot_success_panel(
            axis,
            groups[group],
            group,
            "rounds",
            models[group],
            "Agent rounds",
        )
    axes[0].set_ylabel("Run-level harness success")
    axes[2].set_ylabel("Run-level harness success")
    axes[1].set_yticklabels([])
    axes[3].set_yticklabels([])
    add_figure_notes(
        figure,
        r"ESTIMAND · Q1-to-Q3 fitted probability difference (95% model-based CI); logit(P(success)) = $\alpha + \beta\log(1+n)$.",
    )
    save(figure, output_dir, "05-rounds-vs-success")
    return models


def component_totals(rows: list[dict]) -> dict[str, float]:
    input_tokens = sum(row["input_tokens"] for row in rows)
    cached = sum(row["cached_input_tokens"] for row in rows)
    output = sum(row["output_tokens"] for row in rows)
    uncached = input_tokens - cached
    return {
        "uncached_input_tokens": float(uncached),
        "cached_input_tokens": float(cached),
        "output_tokens": float(output),
        "uncached_input_cost": uncached * PRICE["uncached_input"] / 1_000_000,
        "cached_input_cost": cached * PRICE["cached_input"] / 1_000_000,
        "output_cost": output * PRICE["output"] / 1_000_000,
    }


def plot_token_cost_composition(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Descriptive relationship 3 · observed composition",
        "Token volume and estimated cost composition",
        "Shares are computed from included run-level token components under the benchmark pricing rule.",
        1,
        2,
    )
    figure.subplots_adjust(
        left=0.15,
        right=0.96,
        bottom=0.19,
        top=0.65,
        wspace=0.20,
    )
    composition: dict[str, dict] = {}
    component_order = ("uncached_input", "cached_input", "output")
    token_rows: list[np.ndarray] = []
    cost_rows: list[np.ndarray] = []
    for group in AGENT_ORDER:
        totals = component_totals(groups[group])
        token_values = np.array(
            [
                totals["uncached_input_tokens"],
                totals["cached_input_tokens"],
                totals["output_tokens"],
            ],
            dtype=float,
        )
        cost_values = np.array(
            [
                totals["uncached_input_cost"],
                totals["cached_input_cost"],
                totals["output_cost"],
            ],
            dtype=float,
        )
        token_share = token_values / np.sum(token_values) * 100
        cost_share = cost_values / np.sum(cost_values) * 100
        composition[group] = {
            "token_share_percent": dict(zip(component_order, token_share.tolist())),
            "cost_share_percent": dict(zip(component_order, cost_share.tolist())),
        }
        token_rows.append(token_share)
        cost_rows.append(cost_share)

    # Four compact rows keep every configuration visible without increasing the
    # overall report figure height.
    y_positions = np.arange(len(AGENT_ORDER))[::-1] * 0.82
    for axis, metric_rows, panel_title in zip(
        axes,
        (token_rows, cost_rows),
        ("A · Token volume", "B · Estimated cost"),
    ):
        for y, shares in zip(y_positions, metric_rows):
            left = 0.0
            for component, share in zip(component_order, shares):
                axis.barh(
                    y,
                    share,
                    left=left,
                    height=0.44,
                    color=COMPONENT_COLORS[component],
                    edgecolor=BACKGROUND,
                    linewidth=0.7,
                )
                if share >= 7:
                    axis.text(
                        left + share / 2,
                        y,
                        f"{share:.1f}%",
                        ha="center",
                        va="center",
                        color=BACKGROUND if component != "cached_input" else INK,
                        fontsize=8.5,
                        weight="bold",
                    )
                left += share
            axis.text(
                99.0,
                y + 0.29,
                f"output {shares[2]:.2f}%",
                ha="right",
                va="bottom",
                fontsize=7.7,
                color=MUTED,
            )
        axis.set_title(panel_title, loc="left", fontsize=11.5, weight="bold", pad=10)
        axis.set_xlim(0, 100)
        axis.set_ylim(-0.38, y_positions[0] + 0.48)
        axis.set_xlabel("Share of configuration total")
        axis.xaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
        axis.grid(axis="x")
        axis.grid(axis="y", visible=False)
        axis.spines[["left"]].set_visible(False)
    axes[0].set_yticks(
        y_positions,
        labels=[f"{LABELS[group]} · n={len(groups[group])}" for group in AGENT_ORDER],
    )
    axes[1].set_yticks(y_positions, labels=[])
    handles = [
        mpl.patches.Patch(color=COMPONENT_COLORS[key], label=label)
        for key, label in (
            ("uncached_input", "Uncached input"),
            ("cached_input", "Cached input"),
            ("output", "Output"),
        )
    ]
    figure.legend(
        handles=handles,
        loc="upper center",
        ncols=3,
        frameon=False,
        bbox_to_anchor=(0.55, 0.715),
        fontsize=9.2,
    )
    add_figure_notes(
        figure,
        f"ESTIMAND · Component share of configuration totals. Estimated cost = ${PRICE['uncached_input']:g}×uncached input + ${PRICE['cached_input']:g}×cached input + ${PRICE['output']:g}×output per 1M tokens.",
        left=0.11,
    )
    save(figure, output_dir, "06-token-volume-vs-cost-composition")
    return composition


def plot_command_success(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Descriptive relationship 4 · weighted binomial regression",
        "Recorded Tura command count and fitted success probability",
        "Separate Tura models; predictor = log(1 + recorded command count).",
        1,
        2,
    )
    figure.subplots_adjust(left=0.09, right=0.96, bottom=0.19, top=0.69, wspace=0.18)
    models: dict[str, dict] = {}
    for axis, group in zip(axes, TURA_GROUPS):
        models[group] = fit_success_association(groups[group], "commands")
        plot_success_panel(
            axis,
            groups[group],
            group,
            "commands",
            models[group],
            "Recorded command records",
        )
    axes[0].set_ylabel("Run-level harness success")
    for axis in axes[1:]:
        axis.set_yticklabels([])
    add_figure_notes(
        figure,
        r"ESTIMAND · Q1-to-Q3 fitted probability difference (95% model-based CI); logit(P(success)) = $\alpha + \beta\log(1+c)$.",
    )
    save(figure, output_dir, "07-tura-commands-vs-success")
    return models


def plot_scaling(
    groups: dict[str, list[dict]], diagnostics: dict, output_dir: Path
) -> dict[str, dict]:
    cost_exponents = [float(diagnostics["cost_models"][group]["p"]) for group in AGENT_ORDER]
    figure, axes = new_panel_figure(
        "Claim 5 · descriptive elasticity over the observed range",
        "Token volume grows faster than billed cost",
        f"Tokens are superlinear; estimated cost is much closer to linear (p = {min(cost_exponents):.2f} to {max(cost_exponents):.2f}).",
        1,
        2,
    )
    figure.subplots_adjust(left=0.09, right=0.96, bottom=0.19, top=0.69, wspace=0.20)
    result: dict[str, dict] = {}
    for axis, metric, ylabel, model_key, panel_title in (
        (axes[0], "total_tokens", "Total tokens", "token_models", "A · Token volume"),
        (axes[1], "cost_usd", "Estimated API cost (USD)", "cost_models", "B · Billed cost"),
    ):
        for group in AGENT_ORDER:
            rows = [
                row for row in groups[group] if row["rounds"] > 0 and row[metric] > 0
            ]
            rounds = np.array([row["rounds"] for row in rows], dtype=float)
            values = np.array([row[metric] for row in rows], dtype=float)
            if metric == "total_tokens":
                item = diagnostics[model_key][group]["power_law"]
                scale = float(item["a_tokens"])
            else:
                item = diagnostics[model_key][group]
                scale = float(item["a_usd"])
            exponent = float(item["p"])
            result.setdefault(group, {})[metric] = {
                "scale": scale,
                "exponent": exponent,
            }
            axis.scatter(
                rounds,
                values,
                s=22,
                color=COLORS[group],
                alpha=0.25,
                linewidth=0,
            )
            x_line = np.geomspace(float(np.min(rounds)), float(np.max(rounds)), 240)
            axis.plot(
                x_line,
                scale * np.power(x_line, exponent),
                color=COLORS[group],
                linewidth=2.3,
                label=f"{LABELS[group]} · p={exponent:.2f}",
            )
        axis.set_xscale("log")
        axis.set_yscale("log")
        axis.set_title(panel_title, loc="left", fontsize=11.5, weight="bold", pad=10)
        axis.set_xlabel("Agent rounds · log scale")
        axis.set_ylabel(ylabel + " · log scale")
        axis.legend(loc="upper left", frameon=False, fontsize=8.2)
        if metric == "cost_usd":
            axis.yaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("${x:g}"))
    for group in AGENT_ORDER:
        token_exponent = float(result[group]["total_tokens"]["exponent"])
        cost_exponent = float(result[group]["cost_usd"]["exponent"])
        result[group]["effective_rate_power_exponent"] = (
            cost_exponent - token_exponent
        )
    add_figure_notes(
        figure,
        r"FIT · $y = a\cdot rounds^p$ on log scales. p summarizes observed-range elasticity; it is not a universal long-run law.",
    )
    save(figure, output_dir, "08-token-vs-cost-scaling")
    return result


def main() -> None:
    args = parse_args()
    config = load_analysis_config(args.config)
    global ANALYSIS_CONFIG, AGENT_ORDER, TURA_GROUPS, PRICE, ANALYSIS_SAMPLE_NOTE
    ANALYSIS_CONFIG = config
    AGENT_ORDER = tuple(config["configurations"])
    TURA_GROUPS = tuple(group for group in AGENT_ORDER if group.startswith("tura-"))
    PRICE = dict(config["pricingUsdPer1mTokens"])
    ANALYSIS_SAMPLE_NOTE = analysis_sample_note(config)
    input_dir = (
        repository_path(args.input)
        if args.input
        else configured_path(config, "outputs", "modelRuns")
    )
    output_dir = (
        repository_path(args.output)
        if args.output
        else configured_path(config, "outputs", "claimCharts")
    )
    results_root = configured_path(config, "resultsRoot")
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = load_rows(
        input_dir / "run-level-data.csv",
        results_root,
        int(config["population"]["relationshipRuns"]),
    )
    diagnostics = json.loads((input_dir / "diagnostics.json").read_text(encoding="utf-8"))
    groups = group_rows(rows)
    summary = aggregate_summary(groups)
    configure_style(
        configured_path(config, "fonts", "regular"),
        configured_path(config, "fonts", "bold"),
    )
    round_success = plot_rounds_not_efficiency(groups, output_dir)
    cost_success = plot_cost_success_frontier(groups, output_dir)
    composition = plot_token_cost_composition(groups, output_dir)
    command_success = plot_command_success(groups, output_dir)
    scaling = plot_scaling(groups, diagnostics, output_dir)
    command_sources: dict[str, int] = defaultdict(int)
    for row in rows:
        command_sources[row["command_count_source"]] += 1
    output = {
        "sample": {
            "runs": len(rows),
            "tasks": len({row["task"] for row in rows}),
            "source": f"{config['outputs']['modelRuns']}/run-level-data.csv",
        },
        "agent_summary": summary,
        "round_command_association": round_success,
        "round_success_association": cost_success,
        "token_cost_composition": composition,
        "command_success_association": command_success,
        "command_count_sources": dict(sorted(command_sources.items())),
        "command_count_comparability": {
            "included": list(TURA_GROUPS),
            "excluded": [group for group in AGENT_ORDER if group not in TURA_GROUPS],
            "reason": "A Codex shell call may wrap multiple shell commands; its unit is not comparable with normalized Tura command records.",
        },
        "scaling": scaling,
        "pricing_usd_per_1m_tokens": PRICE,
    }
    (output_dir / "claim-chart-summary.json").write_text(
        json.dumps(output, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output_dir), "charts": 5, "runs": len(rows)}))


if __name__ == "__main__":
    main()
