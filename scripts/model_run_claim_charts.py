#!/usr/bin/env python3
"""Render five claim-focused charts from the filtered model-run analysis."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
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


AGENT_ORDER = ("tura-balanced", "tura-direct", "codex-cli")
TURA_GROUPS = ("tura-balanced", "tura-direct")
LABELS = {
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
COMPONENT_COLORS = {
    "uncached_input": "#d56538",
    "cached_input": "#008f87",
    "output": "#6b5fb5",
}
PRICE = {"uncached_input": 5.0, "cached_input": 0.5, "output": 30.0}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("assets/model-run-statistics"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/model-run-statistics/claim-charts"),
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def extract_command_count(row: dict) -> tuple[int, str]:
    contract_dir = Path(row["source_path"]).parent
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


def load_rows(path: Path) -> list[dict]:
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
        row["commands"], row["command_count_source"] = extract_command_count(row)
        rows.append(row)
    if len(rows) != 267:
        raise ValueError(f"Expected 267 filtered runs, found {len(rows)}")
    if len({row["run_id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate run IDs")
    if any(row["total_tokens"] <= 0 or row["cost_usd"] <= 0 for row in rows):
        raise ValueError("Claim charts require positive token and cost values")
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


def configure_style(input_dir: Path) -> str:
    regular = input_dir / "assets" / "Archivo-Regular-Official.ttf"
    bold = input_dir / "assets" / "Archivo-Bold.ttf"
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
            "svg.fonttype": "path",
        }
    )
    return family


def new_figure(kicker: str, title: str, subtitle: str) -> tuple[plt.Figure, plt.Axes]:
    figure, axis = plt.subplots(figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(left=0.11, right=0.95, bottom=0.15, top=0.72)
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
    kicker: str, title: str, subtitle: str, columns: int
) -> tuple[plt.Figure, np.ndarray]:
    figure, axes = plt.subplots(1, columns, figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(left=0.08, right=0.95, bottom=0.15, top=0.70, wspace=0.20)
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
    axes_array = np.atleast_1d(axes)
    for axis in axes_array:
        axis.spines[["top", "right"]].set_visible(False)
        axis.spines[["left", "bottom"]].set_color(GRID)
        axis.tick_params(length=0, pad=7)
        axis.grid(axis="y")
        axis.grid(axis="x", alpha=0.35)
    return figure, axes_array


def save(figure: plt.Figure, output_dir: Path, stem: str) -> None:
    figure.savefig(output_dir / f"{stem}.png", dpi=200)
    figure.savefig(output_dir / f"{stem}.svg")
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
    q1_probability, q3_probability = expit(alpha + beta * np.log1p([q1, q3]))
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
        "interquartile_gain_percentage_points": float(
            (q3_probability - q1_probability) * 100
        ),
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
    axis.text(
        0.04,
        0.94,
        LABELS[group],
        transform=axis.transAxes,
        va="top",
        fontsize=11,
        weight="bold",
    )
    axis.text(
        0.04,
        0.84,
        f"IQR fitted gain\n+{float(model['interquartile_gain_percentage_points']):.1f} pp",
        transform=axis.transAxes,
        va="top",
        fontsize=9,
        color=MUTED,
    )
    axis.set_xlim(0, float(np.max(values)) * 1.05)
    axis.set_ylim(-2, 102)
    axis.set_xlabel(xlabel)
    axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))


def plot_rounds_not_efficiency(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Claim 1 · run-level descriptive association",
        "More rounds align with higher success — not higher efficiency",
        "All 267 runs are shown; fitted gains flatten because the model uses log(1 + rounds).",
        3,
    )
    models: dict[str, dict] = {}
    for axis, group in zip(axes, AGENT_ORDER):
        models[group] = fit_success_association(groups[group], "rounds")
        plot_success_panel(axis, groups[group], group, "rounds", models[group], "Agent rounds")
    axes[0].set_ylabel("Run-level harness success")
    for axis in axes[1:]:
        axis.set_yticklabels([])
    figure.text(
        0.08,
        0.055,
        "MODEL · logit(P(success)) = alpha + beta·log(1 + rounds). Association is not a causal round-budget effect.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "04-round-count-vs-success")
    return models


def plot_cost_success_frontier(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Claim 2 · run-level descriptive association",
        "Higher observed spend aligns with higher success",
        "Balanced remains the best aggregate cost–success compromise; the panels show the underlying runs and fitted curves.",
        3,
    )
    models: dict[str, dict] = {}
    for axis, group in zip(axes, AGENT_ORDER):
        models[group] = fit_success_association(groups[group], "cost_usd")
        plot_success_panel(
            axis,
            groups[group],
            group,
            "cost_usd",
            models[group],
            "Estimated API cost (USD)",
        )
        axis.xaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("${x:g}"))
    axes[0].set_ylabel("Run-level harness success")
    for axis in axes[1:]:
        axis.set_yticklabels([])
    figure.text(
        0.08,
        0.055,
        "MODEL · logit(P(success)) = alpha + beta·log(1 + cost). Cost and outcome share task and stopping-policy confounders.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "05-cost-vs-success")
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


def plot_token_cost_composition(groups: dict[str, list[dict]], output_dir: Path) -> dict[str, dict]:
    figure, axis = new_figure(
        "Claim 3 · observed usage composition",
        "Tura spends a larger share on output than Codex",
        "Output remains small by token count in every group, but both Tura modes show a distinctly larger output share.",
    )
    y_positions: list[float] = []
    y_labels: list[str] = []
    composition: dict[str, dict] = {}
    component_order = ("uncached_input", "cached_input", "output")
    codex_totals = component_totals(groups["codex-cli"])
    codex_token_values = np.array(
        [
            codex_totals["uncached_input_tokens"],
            codex_totals["cached_input_tokens"],
            codex_totals["output_tokens"],
        ],
        dtype=float,
    )
    codex_cost_values = np.array(
        [
            codex_totals["uncached_input_cost"],
            codex_totals["cached_input_cost"],
            codex_totals["output_cost"],
        ],
        dtype=float,
    )
    codex_output_token_share = codex_token_values[2] / np.sum(codex_token_values) * 100
    codex_output_cost_share = codex_cost_values[2] / np.sum(codex_cost_values) * 100
    for group_index, group in enumerate(AGENT_ORDER):
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
        base_y = 5.0 - group_index * 2.0
        for metric_index, (metric_label, shares) in enumerate(
            (("Token volume", token_share), ("USD cost", cost_share))
        ):
            y = base_y - metric_index * 0.62
            left = 0.0
            for component, share in zip(component_order, shares):
                axis.barh(
                    y,
                    share,
                    left=left,
                    height=0.42,
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
                        fontsize=9,
                        weight="bold",
                    )
                left += share
            y_positions.append(y)
            y_labels.append(metric_label)
        axis.text(
            -1.2,
            base_y + 0.43,
            LABELS[group],
            ha="left",
            va="bottom",
            fontsize=11,
            weight="bold",
            color=INK,
        )
        multiple_text = ""
        if group != "codex-cli":
            multiple_text = (
                f"\n{token_share[2] / codex_output_token_share:.1f}x token share"
                f" · {cost_share[2] / codex_output_cost_share:.1f}x cost share"
            )
        axis.text(
            101.5,
            base_y - 0.31,
            f"Output: {token_share[2]:.2f}% tokens\n→ {cost_share[2]:.1f}% cost{multiple_text}",
            ha="left",
            va="center",
            fontsize=9,
            color=MUTED,
        )
    axis.set_xlim(0, 119)
    axis.set_ylim(-0.2, 5.8)
    axis.set_yticks(y_positions, labels=y_labels)
    axis.set_xlabel("Share of group total")
    axis.xaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
    axis.grid(axis="x")
    axis.grid(axis="y", visible=False)
    axis.spines[["left"]].set_visible(False)
    handles = [
        mpl.patches.Patch(color=COMPONENT_COLORS[key], label=label)
        for key, label in (
            ("uncached_input", "Uncached input"),
            ("cached_input", "Cached input"),
            ("output", "Output"),
        )
    ]
    axis.legend(handles=handles, loc="lower left", ncols=3, frameon=False, bbox_to_anchor=(0, -0.24))
    figure.text(
        0.11,
        0.055,
        "PRICE · Cost = 5.0×uncached input + 0.5×cached input + 30.0×output per 1M tokens. Multiples compare each Tura mode with Codex.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "06-token-volume-vs-cost-composition")
    return composition


def plot_command_success(
    groups: dict[str, list[dict]], output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Claim 4 · Tura-only run-level association",
        "More recorded Tura commands align with higher success",
        "Codex is excluded: one shell call can wrap several shell commands, so its command unit is not comparable.",
        2,
    )
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
    figure.text(
        0.08,
        0.055,
        "MODEL · logit(P(success)) = alpha + beta·log(1 + recorded commands). Counts come from normalized Tura contracts.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "07-command-count-vs-success")
    return models


def plot_scaling(
    groups: dict[str, list[dict]], diagnostics: dict, output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Claim 5 · descriptive elasticity over the observed range",
        "Token volume grows faster than billed cost",
        "Total tokens are superlinear and subquadratic; estimated API cost is near-linear or mildly sublinear.",
        2,
    )
    result: dict[str, dict] = {}
    for axis, metric, ylabel, model_key in (
        (axes[0], "total_tokens", "Total tokens", "token_models"),
        (axes[1], "cost_usd", "Estimated API cost (USD)", "cost_models"),
    ):
        for group in AGENT_ORDER:
            rows = groups[group]
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
            x_line = np.geomspace(min(rounds), max(rounds), 240)
            axis.plot(
                x_line,
                scale * np.power(x_line, exponent),
                color=COLORS[group],
                linewidth=2.3,
                label=f"{LABELS[group]} · p={exponent:.2f}",
            )
        axis.set_xscale("log")
        axis.set_yscale("log")
        axis.set_xlabel("Agent rounds · log scale")
        axis.set_ylabel(ylabel + " · log scale")
        axis.legend(loc="upper left", frameon=False, fontsize=9)
        if metric == "cost_usd":
            axis.yaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("${x:g}"))
    figure.text(0.17, 0.71, "TOKEN VOLUME", color=MUTED, fontsize=9, weight="bold")
    figure.text(0.62, 0.71, "BILLED COST", color=MUTED, fontsize=9, weight="bold")
    figure.text(
        0.08,
        0.055,
        "FIT · y = a·rounds^p on log scales. p summarizes observed-range elasticity; it is not a claim of a universal long-run law.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "08-token-vs-cost-scaling")
    return result


def main() -> None:
    args = parse_args()
    input_dir = args.input.resolve()
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = load_rows(input_dir / "run-level-data.csv")
    diagnostics = json.loads((input_dir / "diagnostics.json").read_text(encoding="utf-8"))
    groups = group_rows(rows)
    summary = aggregate_summary(groups)
    configure_style(input_dir)
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
            "source": str((input_dir / "run-level-data.csv").resolve()),
        },
        "agent_summary": summary,
        "round_success_association": round_success,
        "cost_success_association": cost_success,
        "token_cost_composition": composition,
        "command_success_association": command_success,
        "command_count_sources": dict(sorted(command_sources.items())),
        "command_count_comparability": {
            "included": list(TURA_GROUPS),
            "excluded": ["codex-cli"],
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
