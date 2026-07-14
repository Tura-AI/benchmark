#!/usr/bin/env python3
"""Measure submitted rewrite source lines and relate them to harness outcomes."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.font_manager import FontProperties, fontManager
from scipy.stats import spearmanr


AGENT_ORDER = ("tura-balanced", "tura-direct", "codex-cli")
LABELS = {
    "tura-balanced": "Tura Balanced",
    "tura-direct": "Tura Direct",
    "codex-cli": "Codex CLI",
}
SHORT_LABELS = {
    "tura-balanced": "Balanced",
    "tura-direct": "Direct",
    "codex-cli": "Codex",
}
COLORS = {
    "tura-balanced": "#008f87",
    "tura-direct": "#d56538",
    "codex-cli": "#6b5fb5",
}
TASK_ORDER = (
    "eza",
    "nushell",
    "prompt-gallery-tanstack-fullstack-rebuild",
    "xsv",
    "zip-password-finder",
)
TASK_LABELS = {
    "eza": "eza",
    "nushell": "Nushell",
    "prompt-gallery-tanstack-fullstack-rebuild": "TanStack gallery",
    "xsv": "xsv",
    "zip-password-finder": "ZIP finder",
}
TASK_COLORS = {
    "eza": "#008f87",
    "nushell": "#d56538",
    "prompt-gallery-tanstack-fullstack-rebuild": "#6b5fb5",
    "xsv": "#3978a8",
    "zip-password-finder": "#a6732f",
}
BACKGROUND = "#f4f1ea"
INK = "#0a0a0a"
MUTED = "#474747"
GRID = "#dedbd2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("results/rewrite/report-20260710-gpt56-sol"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/rewrite-code-statistics"),
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def physical_lines(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    return len(re.split(r"\r?\n", text))


def cli_source_files(workspace: Path) -> list[Path]:
    files: list[Path] = []
    for path in workspace.rglob("*.py"):
        relative = path.relative_to(workspace)
        parts = {part.lower() for part in relative.parts}
        name = path.name.lower()
        if parts & {"rust-reference", "harness", "tests", ".tura", "__pycache__"}:
            continue
        if any(word in name for word in ("test", "verify", "differential")):
            continue
        files.append(path)
    return sorted(files)


def submitted_source_lines(run_dir: Path, task: str, agent: str) -> tuple[int | None, str, list[str]]:
    if task == "prompt-gallery-tanstack-fullstack-rebuild":
        summary = load_json(run_dir / "metadata" / "summary.json")
        score = summary["comparison"]["scores"][agent]
        return int(score["source_lines"]), "summary.comparison.scores.source_lines", []

    workspace = run_dir / "workspace"
    files = cli_source_files(workspace)
    if not files:
        recovery = workspace / "WORKSPACE_RECOVERY.md"
        if recovery.exists() and "patch bodies" in recovery.read_text(encoding="utf-8"):
            return None, "unrecoverable-untracked-source", []
        return None, "no-submitted-production-source", []
    relative_files = [path.relative_to(workspace).as_posix() for path in files]
    return (
        sum(physical_lines(path) for path in files),
        "published-workspace-production-python",
        relative_files,
    )


def load_rows(report_dir: Path) -> list[dict]:
    manifest = load_json(report_dir / "canonical-manifest.json")
    runs = manifest["runs"]
    if len(runs) != 30:
        raise ValueError(f"Expected 30 canonical rewrite runs, found {len(runs)}")
    rows: list[dict] = []
    for run in runs:
        run_dir = report_dir / run["task"] / run["agent"] / run["runId"]
        lines, source, files = submitted_source_lines(
            run_dir,
            run["task"],
            run["agent"],
        )
        rows.append(
            {
                "run_id": run["runId"],
                "task": run["task"],
                "agent": run["agent"],
                "replicate": int(run["replicate"]),
                "source_lines": lines,
                "source_line_source": source,
                "source_files": files,
                "passed": int(run["passed"]),
                "checks": int(run["total"]),
                "success_rate": int(run["passed"]) / int(run["total"]),
            }
        )
    if {row["task"] for row in rows} != set(TASK_ORDER):
        raise ValueError("Unexpected rewrite task inventory")
    return rows


def write_rows(rows: list[dict], output_dir: Path) -> None:
    path = output_dir / "run-level-code-harness.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=(
                "run_id",
                "task",
                "agent",
                "replicate",
                "source_lines",
                "source_line_source",
                "source_files",
                "passed",
                "checks",
                "success_rate",
            ),
        )
        writer.writeheader()
        for row in rows:
            record = dict(row)
            record["source_files"] = ";".join(record["source_files"])
            writer.writerow(record)


def configure_style() -> None:
    font_path = Path("assets/model-run-statistics/assets/Archivo-Regular-Official.ttf")
    bold_path = Path("assets/model-run-statistics/assets/Archivo-Bold.ttf")
    for path in (font_path, bold_path):
        if path.exists():
            fontManager.addfont(str(path))
    family = FontProperties(fname=str(font_path)).get_name() if font_path.exists() else "Arial"
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


def save(figure: plt.Figure, output_dir: Path, stem: str) -> None:
    figure.savefig(output_dir / f"{stem}.png", dpi=200)
    figure.savefig(output_dir / f"{stem}.svg")
    plt.close(figure)


def task_summary(rows: list[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for task in TASK_ORDER:
        task_rows = [row for row in rows if row["task"] == task]
        observed = [row for row in task_rows if row["source_lines"] is not None]
        values = np.array([row["source_lines"] for row in observed], dtype=float)
        rates = np.array([row["success_rate"] for row in observed], dtype=float)
        correlation = (
            spearmanr(values, rates).statistic
            if len(set(values)) > 1 and len(set(rates)) > 1
            else np.nan
        )
        result[task] = {
            "canonical_runs": len(task_rows),
            "source_line_runs": len(observed),
            "missing_source_line_runs": [
                row["run_id"] for row in task_rows if row["source_lines"] is None
            ],
            "harness_items_per_run": task_rows[0]["checks"],
            "source_lines_min": int(np.min(values)),
            "source_lines_median": float(np.median(values)),
            "source_lines_max": int(np.max(values)),
            "spearman_source_lines_vs_success": (
                None if np.isnan(correlation) else float(correlation)
            ),
        }
    return result


def plot_lines_vs_success(rows: list[dict], summary: dict[str, dict], output_dir: Path) -> None:
    figure, axes = plt.subplots(2, 3, figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(left=0.08, right=0.96, bottom=0.15, top=0.69, hspace=0.42, wspace=0.24)
    figure.text(0.08, 0.93, "REWRITE · 24 OF 30 CANONICAL RUNS", color=MUTED, fontsize=10, weight="bold")
    figure.text(0.08, 0.855, "Submitted code size and harness success, by task", fontsize=26, weight="bold")
    figure.text(
        0.08,
        0.795,
        "Each panel keeps one harness fixed. Lines are descriptive fits; marker labels identify replicate 1 or 2.",
        color=MUTED,
        fontsize=12,
    )
    figure.add_artist(
        mpl.lines.Line2D(
            [0.08, 0.96],
            [0.75, 0.75],
            transform=figure.transFigure,
            color=GRID,
            linewidth=0.7,
        )
    )

    flat_axes = axes.ravel()
    for axis, task in zip(flat_axes, TASK_ORDER):
        task_rows = [
            row for row in rows if row["task"] == task and row["source_lines"] is not None
        ]
        x = np.array([row["source_lines"] for row in task_rows], dtype=float)
        y = np.array([row["success_rate"] * 100 for row in task_rows], dtype=float)
        if len(set(x)) > 1:
            slope, intercept = np.polyfit(x, y, 1)
            x_line = np.linspace(np.min(x), np.max(x), 120)
            axis.plot(x_line, intercept + slope * x_line, color=INK, alpha=0.35, linewidth=1.4)
        for row in task_rows:
            axis.scatter(
                row["source_lines"],
                row["success_rate"] * 100,
                s=58,
                color=COLORS[row["agent"]],
                edgecolor=BACKGROUND,
                linewidth=1.0,
                zorder=3,
            )
            axis.annotate(
                str(row["replicate"]),
                (row["source_lines"], row["success_rate"] * 100),
                xytext=(4, 4),
                textcoords="offset points",
                fontsize=7,
                color=MUTED,
            )
        rho = summary[task]["spearman_source_lines_vs_success"]
        rho_text = "n/a" if rho is None else f"{rho:+.2f}"
        axis.set_title(
            f"{TASK_LABELS[task]}\nSpearman rho = {rho_text} · n={len(task_rows)}",
            loc="left",
            fontsize=10,
            weight="bold",
            pad=9,
        )
        axis.set_ylim(-3, 103)
        axis.set_xlim(max(0, np.min(x) * 0.84), np.max(x) * 1.09)
        axis.set_xlabel("Submitted source lines")
        axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
        axis.grid(axis="y")
        axis.grid(axis="x", alpha=0.35)
        axis.spines[["top", "right"]].set_visible(False)
        axis.tick_params(length=0, pad=6, labelsize=8)
    flat_axes[0].set_ylabel("Harness success")
    flat_axes[3].set_ylabel("Harness success")
    flat_axes[-1].axis("off")
    handles = [
        mpl.lines.Line2D(
            [],
            [],
            marker="o",
            linestyle="none",
            markersize=7,
            color=COLORS[group],
            label=LABELS[group],
        )
        for group in AGENT_ORDER
    ]
    figure.legend(handles=handles, loc="lower center", ncols=3, frameon=False, bbox_to_anchor=(0.5, 0.09))
    figure.text(
        0.08,
        0.035,
        "COVERAGE · Six Codex CLI source-port workspaces retain paths but not final untracked source bodies; those runs are not assigned zero lines.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "09-rewrite-submitted-lines-vs-success")


def plot_lines_vs_harness_items(summary: dict[str, dict], output_dir: Path) -> None:
    figure, axis = plt.subplots(figsize=(12.8, 8.0), dpi=160)
    figure.subplots_adjust(left=0.11, right=0.95, bottom=0.15, top=0.72)
    figure.text(0.11, 0.93, "REWRITE · FIVE TASK CONTRACTS", color=MUTED, fontsize=10, weight="bold")
    figure.text(0.11, 0.855, "Submitted code size and harness item count, by task", fontsize=26, weight="bold")
    figure.text(
        0.11,
        0.795,
        "Dots show median submitted source lines; horizontal rules span the observed run range for each task.",
        color=MUTED,
        fontsize=12,
    )
    figure.add_artist(
        mpl.lines.Line2D(
            [0.11, 0.95],
            [0.755, 0.755],
            transform=figure.transFigure,
            color=GRID,
            linewidth=0.7,
        )
    )
    x_values = []
    y_values = []
    for task in TASK_ORDER:
        item = summary[task]
        x = item["source_lines_median"]
        y = item["harness_items_per_run"]
        x_values.append(x)
        y_values.append(y)
        axis.hlines(
            y,
            item["source_lines_min"],
            item["source_lines_max"],
            color=TASK_COLORS[task],
            linewidth=2.0,
            alpha=0.65,
        )
        axis.scatter(
            x,
            y,
            s=115,
            color=TASK_COLORS[task],
            edgecolor=BACKGROUND,
            linewidth=1.4,
            zorder=3,
        )
        axis.annotate(
            f"{TASK_LABELS[task]}\n{y} items · median {x:,.0f} lines",
            (x, y),
            xytext=(8, 8 if task != "eza" else -31),
            textcoords="offset points",
            fontsize=9,
            color=INK,
        )
    rho = float(spearmanr(x_values, y_values).statistic)
    axis.set_xlim(300, max(item["source_lines_max"] for item in summary.values()) * 1.10)
    axis.set_ylim(10, 69)
    axis.set_xlabel("Submitted source lines per run · median and observed range")
    axis.set_ylabel("Stable harness items per run")
    axis.grid(axis="both")
    axis.spines[["top", "right"]].set_visible(False)
    axis.tick_params(length=0, pad=8)
    figure.text(
        0.11,
        0.065,
        f"READING · Across five tasks, Spearman rho = {rho:+.2f}. Harness counts reflect specification granularity, not an LOC quota.",
        color=MUTED,
        fontsize=9,
    )
    save(figure, output_dir, "10-rewrite-submitted-lines-vs-harness-items")


def main() -> None:
    args = parse_args()
    report_dir = args.report.resolve()
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = load_rows(report_dir)
    write_rows(rows, output_dir)
    summary = task_summary(rows)
    configure_style()
    plot_lines_vs_success(rows, summary, output_dir)
    plot_lines_vs_harness_items(summary, output_dir)
    output = {
        "report": str(report_dir),
        "canonical_runs": len(rows),
        "source_line_runs": sum(row["source_lines"] is not None for row in rows),
        "missing_source_line_runs": [
            row["run_id"] for row in rows if row["source_lines"] is None
        ],
        "line_definition": {
            "cli": "Physical lines in submitted production Python files; excludes harness, tests, .tura, rust-reference, and test/verify/differential helpers.",
            "tanstack": "Archived evaluator source_lines over src/app/routes plus package and supported app/vite/vinxi/tanstack config files.",
        },
        "task_summary": summary,
    }
    (output_dir / "summary.json").write_text(
        json.dumps(output, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(output_dir),
                "charts": 2,
                "canonical_runs": len(rows),
                "source_line_runs": output["source_line_runs"],
            }
        )
    )


if __name__ == "__main__":
    main()
