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
from scipy.special import expit


AGENT_ORDER = ("tura-balanced", "tura-direct", "codex-cli")
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
        rows.append(row)
    if len(rows) != 267:
        raise ValueError(f"Expected 267 filtered runs, found {len(rows)}")
    if len({row["run_id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate run IDs")
    if any(row["total_tokens"] <= 0 or row["cost_usd"] <= 0 for row in rows):
        raise ValueError("Claim charts require positive token and cost values")
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


def plot_rounds_not_efficiency(summary: dict[str, dict], output_dir: Path) -> None:
    figure, axis = new_figure(
        "Claim 1 · descriptive system comparison",
        "Round count is not an efficiency score",
        "Codex and Direct reach almost the same weighted success with very different round budgets.",
    )
    for group in AGENT_ORDER:
        item = summary[group]
        x = item["mean_rounds"]
        y = item["success_rate"] * 100
        axis.scatter(
            x,
            y,
            s=330,
            color=COLORS[group],
            edgecolor=BACKGROUND,
            linewidth=2.0,
            zorder=3,
        )
        offsets = {
            "tura-balanced": (1.8, 0.5),
            "tura-direct": (1.8, -2.0),
            "codex-cli": (-15.5, 1.0),
        }
        dx, dy = offsets[group]
        axis.text(x + dx, y + dy, LABELS[group], fontsize=12, weight="bold", color=INK)
        axis.text(
            x + dx,
            y + dy - 1.8,
            f"{x:.1f} rounds · {y:.1f}% success",
            fontsize=9,
            color=MUTED,
        )
    direct = summary["tura-direct"]
    codex = summary["codex-cli"]
    axis.plot(
        [direct["mean_rounds"], codex["mean_rounds"]],
        [direct["success_rate"] * 100, codex["success_rate"] * 100],
        color=GRID,
        linewidth=1.2,
        linestyle="--",
        zorder=1,
    )
    axis.set_xlim(0, 56)
    axis.set_ylim(67, 83)
    axis.set_xlabel("Mean agent rounds per run")
    axis.set_ylabel("Weighted harness success")
    axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
    figure.text(
        0.11,
        0.065,
        "READING · Rounds measure process length. Efficiency needs an outcome and a resource measure; fewer rounds alone is not better.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "04-round-count-is-not-efficiency")


def plot_cost_success_frontier(summary: dict[str, dict], output_dir: Path) -> None:
    figure, axis = new_figure(
        "Claim 2 · observed Pareto comparison",
        "Balanced offers the strongest cost–success compromise",
        "Direct is the low-cost endpoint; Balanced is the higher-success endpoint and dominates Codex in this sample.",
    )
    frontier = ("tura-direct", "tura-balanced")
    axis.plot(
        [summary[group]["mean_cost_usd"] for group in frontier],
        [summary[group]["success_rate"] * 100 for group in frontier],
        color=INK,
        linewidth=1.2,
        linestyle="--",
        alpha=0.55,
        zorder=1,
    )
    for group in AGENT_ORDER:
        item = summary[group]
        x = item["mean_cost_usd"]
        y = item["success_rate"] * 100
        axis.scatter(
            x,
            y,
            s=380 if group == "tura-balanced" else 300,
            color=COLORS[group],
            edgecolor=INK if group == "tura-balanced" else BACKGROUND,
            linewidth=1.8,
            zorder=3,
        )
        dx, dy = {
            "tura-balanced": (0.10, 0.4),
            "tura-direct": (0.10, -1.8),
            "codex-cli": (-0.92, 0.5),
        }[group]
        axis.text(x + dx, y + dy, LABELS[group], fontsize=12, weight="bold")
        axis.text(
            x + dx,
            y + dy - 1.7,
            f"${x:.2f}/run · {y:.1f}%",
            fontsize=9,
            color=MUTED,
        )
    axis.annotate(
        "Balanced: lower cost and higher success\nthan Codex in this sample",
        xy=(summary["tura-balanced"]["mean_cost_usd"], summary["tura-balanced"]["success_rate"] * 100),
        xytext=(3.42, 76.4),
        fontsize=9,
        color=MUTED,
        arrowprops={"arrowstyle": "-", "color": GRID, "linewidth": 1.0},
    )
    axis.set_xlim(1.25, 4.65)
    axis.set_ylim(68, 82)
    axis.set_xlabel("Mean estimated API cost per run (USD)")
    axis.set_ylabel("Weighted harness success")
    axis.xaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("${x:.1f}"))
    axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
    figure.text(
        0.11,
        0.065,
        "PARETO RULE · A dominates B when cost_A <= cost_B and success_A >= success_B, with at least one strict inequality.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "05-cost-success-frontier")


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


def plot_success_saturation(
    groups: dict[str, list[dict]], diagnostics: dict, output_dir: Path
) -> dict[str, dict]:
    figure, axes = new_panel_figure(
        "Claim 4 · fitted association, not causal treatment",
        "Success rises along a saturating curve",
        "The fitted marginal gain declines as rounds increase; the data do not identify one universal threshold.",
        3,
    )
    saturation: dict[str, dict] = {}
    for axis, group in zip(axes, AGENT_ORDER):
        rows = groups[group]
        params = diagnostics["success_models"][group]
        alpha = float(params["alpha"])
        beta = float(params["beta"])
        rounds = np.array([row["rounds"] for row in rows], dtype=float)
        rates = np.array([row["success_rate"] for row in rows], dtype=float) * 100
        checks = np.array([row["checks"] for row in rows], dtype=float)
        jittered = np.array(
            [
                np.clip(rate + stable_jitter(row["run_id"], 2.4), 0, 100)
                for row, rate in zip(rows, rates)
            ]
        )
        axis.scatter(
            rounds,
            jittered,
            s=14 + 3.5 * np.sqrt(checks),
            color=COLORS[group],
            alpha=0.23,
            linewidth=0,
            zorder=2,
        )
        x_line = np.linspace(max(1, min(rounds)), max(rounds), 300)
        y_line = expit(alpha + beta * np.log1p(x_line)) * 100
        axis.plot(x_line, y_line, color=COLORS[group], linewidth=2.6, zorder=3)
        probability = lambda n: float(expit(alpha + beta * math.log1p(n)))
        gain_10_20 = (probability(20) - probability(10)) * 100
        gain_20_30 = (probability(30) - probability(20)) * 100
        saturation[group] = {
            "gain_10_to_20_percentage_points": gain_10_20,
            "gain_20_to_30_percentage_points": gain_20_30,
            "observed_min_rounds": int(min(rounds)),
            "observed_max_rounds": int(max(rounds)),
        }
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
            f"10→20: +{gain_10_20:.1f} pp\n20→30: +{gain_20_30:.1f} pp",
            transform=axis.transAxes,
            va="top",
            fontsize=9,
            color=MUTED,
        )
        axis.set_xlim(0, max(rounds) * 1.05)
        axis.set_ylim(-2, 102)
        axis.set_xlabel("Rounds")
        axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
    axes[0].set_ylabel("Run-level harness success")
    for axis in axes[1:]:
        axis.set_yticklabels([])
    figure.text(
        0.08,
        0.055,
        "MODEL · logit(P(success)) = alpha + beta·log(1 + rounds). Curves stop at each group's observed maximum.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "07-success-saturation")
    return saturation


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
    plot_rounds_not_efficiency(summary, output_dir)
    plot_cost_success_frontier(summary, output_dir)
    composition = plot_token_cost_composition(groups, output_dir)
    saturation = plot_success_saturation(groups, diagnostics, output_dir)
    scaling = plot_scaling(groups, diagnostics, output_dir)
    output = {
        "sample": {
            "runs": len(rows),
            "tasks": len({row["task"] for row in rows}),
            "source": str((input_dir / "run-level-data.csv").resolve()),
        },
        "agent_summary": summary,
        "token_cost_composition": composition,
        "success_saturation": saturation,
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
