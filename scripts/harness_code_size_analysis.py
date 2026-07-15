#!/usr/bin/env python3
"""Relate submitted production-code additions to run-level harness success."""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.font_manager import FontProperties, fontManager
from scipy.optimize import minimize
from scipy.special import expit
from scipy.stats import t as student_t

from analysis_config import configured_path, load_analysis_config, repository_path


ANALYSIS_CONFIG = load_analysis_config()
AGENT_ORDER = tuple(ANALYSIS_CONFIG["configurations"])
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
SOURCE_EXTENSIONS = set(ANALYSIS_CONFIG["codeMetric"]["sourceExtensions"])
EXCLUDED_PATH_PARTS = set(ANALYSIS_CONFIG["codeMetric"]["excludedPathParts"])
EXCLUDED_FILE_NAME_PATTERN = re.compile(
    ANALYSIS_CONFIG["codeMetric"]["excludedFileNamePattern"]
)
ARCHIVED_SOURCE_LINE_TASKS = set(
    ANALYSIS_CONFIG["codeMetric"]["archivedEvaluatorSourceLineTasks"]
)
BACKGROUND = "#f4f1ea"
INK = "#0a0a0a"
MUTED = "#474747"
GRID = "#d8d4ca"


def scope_note(config: dict) -> str:
    population = config["population"]
    rounds = " and ".join(
        str(item["rounds"]) for item in config["relationshipExclusions"]
    )
    return (
        f"SCOPE · {population['relationshipRuns']} runs after excluding "
        f"{len(config['relationshipExclusions'])} configured long-tail observations "
        f"({rounds} rounds)."
    )


SCOPE_NOTE = scope_note(ANALYSIS_CONFIG)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config/analysis.json"))
    parser.add_argument(
        "--run-data",
        type=Path,
    )
    parser.add_argument(
        "--rewrite-reports",
        type=Path,
        nargs="+",
    )
    parser.add_argument(
        "--output",
        type=Path,
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def configuration_id(agent_id: str) -> str:
    if agent_id.startswith("tura-balanced"):
        return "tura-balanced"
    if agent_id.startswith("tura-direct"):
        return "tura-direct"
    if agent_id.endswith("-medium"):
        return "codex-cli-medium"
    if agent_id.endswith("-high"):
        return "codex-cli-high"
    raise ValueError(f"Unknown configuration: {agent_id}")


def is_production_source(path: str) -> bool:
    value = path.replace("\\", "/").lower()
    parts = value.split("/")
    name = parts[-1]
    if Path(name).suffix not in SOURCE_EXTENSIONS:
        return False
    if any(part in EXCLUDED_PATH_PARTS for part in parts[:-1]):
        return False
    return EXCLUDED_FILE_NAME_PATTERN.search(name) is None


def debug_production_additions(harness_report: Path) -> tuple[int, list[str]]:
    patch = harness_report.parent / "git-diff.patch"
    if not patch.exists():
        raise FileNotFoundError(f"Missing debug patch: {patch}")
    result = subprocess.run(
        ["git", "apply", "--numstat", str(patch)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    additions = 0
    files: list[str] = []
    for line in result.stdout.splitlines():
        added, _, path = line.split("\t", 2)
        if added != "-" and is_production_source(path):
            additions += int(added)
            files.append(path.replace("\\", "/"))
    return additions, sorted(files)


def physical_lines(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    return len(text.splitlines())


def rewrite_source_files(workspace: Path) -> list[Path]:
    files: list[Path] = []
    for path in workspace.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(workspace)
        if is_production_source(relative.as_posix()):
            files.append(path)
    return sorted(files)


def rewrite_source_lines(run_dir: Path, task: str, agent: str) -> tuple[int | None, str, list[str]]:
    if task in ARCHIVED_SOURCE_LINE_TASKS:
        summary = load_json(run_dir / "metadata" / "summary.json")
        score = summary["comparison"]["scores"][agent]
        return int(score["source_lines"]), "archived-evaluator-source-lines", []

    workspace = run_dir / "workspace"
    files = rewrite_source_files(workspace)
    if not files:
        recovery = workspace / "WORKSPACE_RECOVERY.md"
        if recovery.exists() and "patch bodies" in recovery.read_text(encoding="utf-8"):
            return None, "unrecoverable-untracked-source", []
        return None, "no-retained-production-source", []
    relative_files = [path.relative_to(workspace).as_posix() for path in files]
    return (
        sum(physical_lines(path) for path in files),
        "retained-workspace-production-source",
        relative_files,
    )


def load_rewrite_code(
    reports: tuple[Path, ...], expected_records: int
) -> dict[tuple[str, str], dict]:
    records: dict[tuple[str, str], dict] = {}
    for report_dir in reports:
        manifest = load_json(report_dir / "canonical-manifest.json")
        for run in manifest["runs"]:
            configuration = configuration_id(run["agentId"])
            run_dir = report_dir / run["task"] / run["agent"] / run["runId"]
            lines, source, files = rewrite_source_lines(
                run_dir,
                run["task"],
                run["agent"],
            )
            key = (configuration, run["runId"])
            if key in records:
                raise ValueError(f"Duplicate rewrite source record: {key}")
            records[key] = {
                "production_code_additions": lines,
                "code_measure_source": source,
                "production_source_files": files,
            }
    if len(records) != expected_records:
        raise ValueError(
            f"Expected {expected_records} rewrite source records, found {len(records)}"
        )
    return records


def load_analysis_rows(
    run_data: Path,
    rewrite_reports: tuple[Path, ...],
    results_root: Path,
    expected_rows: int,
    expected_rewrite_records: int,
) -> list[dict]:
    rewrite_code = load_rewrite_code(rewrite_reports, expected_rewrite_records)
    with run_data.open(encoding="utf-8", newline="") as handle:
        raw_rows = list(csv.DictReader(handle))
    if len(raw_rows) != expected_rows:
        raise ValueError(f"Expected {expected_rows} relationship rows, found {len(raw_rows)}")

    rows: list[dict] = []
    for raw in raw_rows:
        if raw["category"] == "debug":
            source_path = Path(raw["source_path"])
            if not source_path.is_absolute():
                source_path = results_root / source_path
            additions, files = debug_production_additions(source_path)
            code = {
                "production_code_additions": additions,
                "code_measure_source": "git-diff-production-additions",
                "production_source_files": files,
            }
        elif raw["category"] == "rewrite":
            key = (raw["agent_group"], raw["run_id"])
            if key not in rewrite_code:
                raise KeyError(f"Missing rewrite code record: {key}")
            code = rewrite_code[key]
        else:
            raise ValueError(f"Unexpected harness category: {raw['category']}")
        rows.append(
            {
                "run_id": raw["run_id"],
                "category": raw["category"],
                "report": raw["report"],
                "task": raw["task"],
                "configuration": raw["agent_group"],
                "passed": int(raw["passed"]),
                "checks": int(raw["checks"]),
                "success_rate": float(raw["success_rate"]),
                **code,
            }
        )
    return rows


def add_within_task_predictor(rows: list[dict]) -> dict:
    observed = [row for row in rows if row["production_code_additions"] is not None]
    by_task: dict[str, list[dict]] = defaultdict(list)
    for row in observed:
        by_task[row["task"]].append(row)

    task_centers: dict[str, float] = {}
    centered_values: list[float] = []
    for task, task_rows in by_task.items():
        transformed = np.log1p(
            np.array([row["production_code_additions"] for row in task_rows], dtype=float)
        )
        center = float(np.median(transformed))
        task_centers[task] = center
        for row, value in zip(task_rows, transformed, strict=True):
            row["centered_log1p_additions"] = float(value - center)
            centered_values.append(float(value - center))

    scale = float(np.std(np.array(centered_values), ddof=1))
    if scale <= 0:
        raise ValueError("Within-task code-size scale must be positive")
    for row in observed:
        row["code_size_z"] = row["centered_log1p_additions"] / scale
    return {
        "task_log1p_medians": task_centers,
        "pooled_within_task_sd": scale,
        "observed_rows": len(observed),
    }


def fit_fractional_logit(
    rows: list[dict],
    name: str,
    category: str | None = None,
    adjust_configuration: bool = False,
) -> dict:
    eligible = [
        row
        for row in rows
        if row["production_code_additions"] is not None
        and (category is None or row["category"] == category)
    ]
    candidate_tasks = sorted({row["task"] for row in eligible})
    varying_tasks = [
        task
        for task in candidate_tasks
        if len({row["success_rate"] for row in eligible if row["task"] == task}) > 1
    ]
    excluded_tasks = sorted(set(candidate_tasks) - set(varying_tasks))
    model_rows = [row for row in eligible if row["task"] in varying_tasks]
    configuration_terms = list(AGENT_ORDER[1:]) if adjust_configuration else []
    design = np.zeros(
        (len(model_rows), len(varying_tasks) + len(configuration_terms) + 1),
        dtype=float,
    )
    for index, row in enumerate(model_rows):
        design[index, varying_tasks.index(row["task"])] = 1.0
        for offset, configuration in enumerate(configuration_terms):
            design[index, len(varying_tasks) + offset] = float(
                row["configuration"] == configuration
            )
        design[index, -1] = row["code_size_z"]
    response = np.array([row["success_rate"] for row in model_rows], dtype=float)

    def objective(params: np.ndarray) -> float:
        eta = design @ params
        return float(np.sum(np.logaddexp(0, eta) - response * eta))

    initial = np.zeros(design.shape[1], dtype=float)
    for task_index, task in enumerate(varying_tasks):
        rate = np.clip(
            np.mean([row["success_rate"] for row in model_rows if row["task"] == task]),
            1e-4,
            1 - 1e-4,
        )
        initial[task_index] = np.log(rate / (1 - rate))
    result = minimize(objective, initial, method="BFGS", options={"gtol": 1e-9})
    if not result.success and np.linalg.norm(result.jac) > 1e-5:
        raise RuntimeError(f"{name} model failed: {result.message}; gradient={result.jac}")
    params = np.asarray(result.x, dtype=float)
    fitted = expit(design @ params)

    bread_inverse = np.linalg.pinv(design.T @ ((fitted * (1 - fitted))[:, None] * design))
    cluster_scores: list[np.ndarray] = []
    for task in varying_tasks:
        indexes = [i for i, row in enumerate(model_rows) if row["task"] == task]
        score = design[indexes].T @ (response[indexes] - fitted[indexes])
        cluster_scores.append(score)
    meat = sum(np.outer(score, score) for score in cluster_scores)
    clusters = len(cluster_scores)
    observations, parameters = design.shape
    correction = (clusters / (clusters - 1)) * ((observations - 1) / (observations - parameters))
    covariance = bread_inverse @ meat @ bread_inverse * correction
    beta = float(params[-1])
    beta_se = float(np.sqrt(max(covariance[-1, -1], 0)))
    critical = float(student_t.ppf(0.975, df=clusters - 1))
    beta_ci = (beta - critical * beta_se, beta + critical * beta_se)
    t_statistic = beta / beta_se
    p_value = float(2 * student_t.sf(abs(t_statistic), df=clusters - 1))

    config_vectors = []
    if adjust_configuration:
        for configuration in AGENT_ORDER:
            vector = np.zeros(len(configuration_terms), dtype=float)
            if configuration in configuration_terms:
                vector[configuration_terms.index(configuration)] = 1.0
            config_vectors.append(vector)
    else:
        config_vectors.append(np.zeros(0, dtype=float))

    def standardized_probability(z: float, coefficients: np.ndarray) -> float:
        values: list[float] = []
        for task_index in range(len(varying_tasks)):
            for config_vector in config_vectors:
                x = np.zeros_like(coefficients)
                x[task_index] = 1.0
                if configuration_terms:
                    x[len(varying_tasks) : -1] = config_vector
                x[-1] = z
                values.append(float(expit(x @ coefficients)))
        return float(np.mean(values))

    contrast = standardized_probability(0.5, params) - standardized_probability(-0.5, params)
    gradient = np.zeros_like(params)
    epsilon = 1e-5
    for index in range(len(params)):
        upper = params.copy()
        lower = params.copy()
        upper[index] += epsilon
        lower[index] -= epsilon
        gradient[index] = (
            standardized_probability(0.5, upper)
            - standardized_probability(-0.5, upper)
            - standardized_probability(0.5, lower)
            + standardized_probability(-0.5, lower)
        ) / (2 * epsilon)
    contrast_se = float(np.sqrt(max(gradient @ covariance @ gradient, 0)))
    contrast_ci = (
        contrast - critical * contrast_se,
        contrast + critical * contrast_se,
    )
    return {
        "name": name,
        "category": category or "all",
        "configuration_adjusted": adjust_configuration,
        "model_rows": len(model_rows),
        "model_tasks": varying_tasks,
        "clusters": clusters,
        "cluster_degrees_of_freedom": clusters - 1,
        "excluded_no_outcome_variation_tasks": excluded_tasks,
        "parameters": params.tolist(),
        "covariance": covariance.tolist(),
        "task_count": len(varying_tasks),
        "configuration_terms": configuration_terms,
        "beta_log_odds_per_sd": beta,
        "beta_cluster_robust_se": beta_se,
        "beta_95_ci": list(beta_ci),
        "cluster_robust_t": t_statistic,
        "cluster_robust_p": p_value,
        "odds_ratio_per_sd": float(np.exp(beta)),
        "odds_ratio_95_ci": [float(np.exp(beta_ci[0])), float(np.exp(beta_ci[1]))],
        "standardized_probability_difference_pp": contrast * 100,
        "standardized_probability_difference_95_ci_pp": [
            contrast_ci[0] * 100,
            contrast_ci[1] * 100,
        ],
    }


def model_probability(model: dict, z_values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    params = np.array(model["parameters"], dtype=float)
    covariance = np.array(model["covariance"], dtype=float)
    task_count = model["task_count"]
    config_terms = model["configuration_terms"]
    critical = float(student_t.ppf(0.975, df=model["cluster_degrees_of_freedom"]))
    configs = [np.zeros(len(config_terms), dtype=float)]
    if config_terms:
        configs = []
        for configuration in AGENT_ORDER:
            vector = np.zeros(len(config_terms), dtype=float)
            if configuration in config_terms:
                vector[config_terms.index(configuration)] = 1.0
            configs.append(vector)

    estimates: list[float] = []
    lows: list[float] = []
    highs: list[float] = []
    for z in z_values:
        vectors: list[np.ndarray] = []
        for task_index in range(task_count):
            for config in configs:
                x = np.zeros_like(params)
                x[task_index] = 1.0
                if config_terms:
                    x[task_count:-1] = config
                x[-1] = z
                vectors.append(x)
        probabilities = np.array([expit(x @ params) for x in vectors])
        estimate = float(np.mean(probabilities))
        gradient = np.mean(
            [probability * (1 - probability) * x for probability, x in zip(probabilities, vectors, strict=True)],
            axis=0,
        )
        standard_error = float(np.sqrt(max(gradient @ covariance @ gradient, 0)))
        estimates.append(estimate)
        lows.append(max(0.0, estimate - critical * standard_error))
        highs.append(min(1.0, estimate + critical * standard_error))
    return np.array(estimates), np.array(lows), np.array(highs)


def configure_style(font_path: Path, bold_path: Path) -> None:
    font_path = font_path if font_path.exists() else None
    if font_path:
        fontManager.addfont(str(font_path))
        if bold_path.exists():
            fontManager.addfont(str(bold_path))
        family = FontProperties(fname=str(font_path)).get_name()
    else:
        family = "Arial"
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


def save(figure: plt.Figure, output: Path, stem: str) -> None:
    figure.savefig(output / f"{stem}.png", dpi=200, bbox_inches="tight", pad_inches=0.12)
    figure.savefig(output / f"{stem}.svg", bbox_inches="tight", pad_inches=0.12)
    plt.close(figure)


def figure_header(figure: plt.Figure, kicker: str, title: str, subtitle: str) -> None:
    figure.text(0.08, 0.945, kicker, color=MUTED, fontsize=10, weight="bold")
    figure.text(0.08, 0.885, title, fontsize=22, weight="bold")
    figure.text(0.08, 0.835, subtitle, color=MUTED, fontsize=11)
    figure.add_artist(
        mpl.lines.Line2D(
            [0.08, 0.95],
            [0.80, 0.80],
            transform=figure.transFigure,
            color=GRID,
            linewidth=0.7,
        )
    )


def plot_relationship(rows: list[dict], models: dict[str, dict], output: Path) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(13.4, 8.2), dpi=160)
    figure.subplots_adjust(left=0.09, right=0.96, bottom=0.20, top=0.73, wspace=0.19)
    figure_header(
        figure,
        "ALL HARNESS TASKS · OBSERVED RUNS AND TASK-STANDARDIZED FITS",
        "Submitted production-code additions and harness success",
        "Each run is one observation; code size is centered within task before fitting.",
    )
    panels = (("debug", "DeepSWE · final patch additions"), ("rewrite", "Rewrite · retained submitted source"))
    rng = np.random.default_rng(20260715)
    for axis, (category, title) in zip(axes, panels, strict=True):
        subset = [row for row in rows if row["category"] == category and "code_size_z" in row]
        for configuration in AGENT_ORDER:
            group = [row for row in subset if row["configuration"] == configuration]
            x = np.array([row["code_size_z"] for row in group])
            y = np.array([row["success_rate"] for row in group])
            if category == "debug":
                y = y + rng.uniform(-0.016, 0.016, size=len(y))
            axis.scatter(
                x,
                y * 100,
                s=28 if category == "debug" else 42,
                color=COLORS[configuration],
                alpha=0.50 if category == "debug" else 0.72,
                linewidth=0,
                label=LABELS[configuration],
                zorder=2,
            )
        model = models[category]
        model_z = [row["code_size_z"] for row in subset if row["task"] in model["model_tasks"]]
        grid = np.linspace(np.quantile(model_z, 0.03), np.quantile(model_z, 0.97), 180)
        estimate, low, high = model_probability(model, grid)
        axis.fill_between(grid, low * 100, high * 100, color=INK, alpha=0.10, linewidth=0)
        axis.plot(grid, estimate * 100, color=INK, linewidth=2.0, zorder=3)
        difference = model["standardized_probability_difference_pp"]
        lower, upper = model["standardized_probability_difference_95_ci_pp"]
        axis.text(
            0.03,
            0.95,
            f"-0.5 to +0.5 SD fitted difference: {difference:+.1f} pp\n"
            f"95% task-clustered CI: {lower:+.1f} to {upper:+.1f} pp",
            transform=axis.transAxes,
            va="top",
            fontsize=9.4,
            color=MUTED,
        )
        axis.set_title(title, loc="left", fontsize=13, weight="bold", pad=14)
        axis.set_xlabel(r"Within-task standardized log(1 + code additions), $z_i$")
        axis.set_ylim(-4, 104)
        axis.set_yticks((0, 25, 50, 75, 100))
        axis.yaxis.set_major_formatter(mpl.ticker.PercentFormatter(100, decimals=0))
        axis.spines[["top", "right"]].set_visible(False)
        axis.tick_params(length=0, pad=7)
        axis.grid(axis="y")
        axis.grid(axis="x", alpha=0.35)
    axes[0].set_ylabel("Run-level harness success ratio")
    axes[1].set_yticklabels([])
    handles = [
        mpl.lines.Line2D([], [], marker="o", linestyle="none", color=COLORS[group], label=LABELS[group])
        for group in AGENT_ORDER
    ]
    figure.legend(handles=handles, loc="lower center", bbox_to_anchor=(0.52, 0.125), ncols=4, frameon=False)
    figure.text(
        0.08,
        0.066,
        r"MODEL · Equal-weight fractional logit: logit(E[$y_i$]) = task FE + $\beta z_i$; CI uses task-clustered CR1 covariance and $t_{G-1}$ critical values.",
        color=MUTED,
        fontsize=8.5,
    )
    figure.text(
        0.08,
        0.032,
        SCOPE_NOTE
        + f" {sum(row['production_code_additions'] is not None for row in rows)} have code counts. "
        "Constant-outcome tasks do not estimate beta.",
        color=MUTED,
        fontsize=8.3,
    )
    save(figure, output, "09-code-additions-vs-harness-success")


def plot_effects(models: list[dict], output: Path) -> None:
    figure, axes = plt.subplots(1, 2, figsize=(13.4, 7.8), dpi=160)
    figure.subplots_adjust(left=0.24, right=0.96, bottom=0.17, top=0.70, wspace=0.28)
    figure_header(
        figure,
        "ALL HARNESS TASKS · TASK-CLUSTERED MODEL ESTIMATES",
        "The estimated association depends on task population and adjustment",
        "Intervals quantify sampling uncertainty across tasks; they do not identify a causal effect of code volume.",
    )
    labels = [model["name"] for model in models]
    y = np.arange(len(models))[::-1]

    odds = np.array([model["odds_ratio_per_sd"] for model in models])
    odds_low = np.array([model["odds_ratio_95_ci"][0] for model in models])
    odds_high = np.array([model["odds_ratio_95_ci"][1] for model in models])
    axes[0].errorbar(
        odds,
        y,
        xerr=np.vstack((odds - odds_low, odds_high - odds)),
        fmt="o",
        color=INK,
        ecolor=INK,
        linewidth=1.4,
        capsize=4,
        markersize=7,
    )
    axes[0].axvline(1, color=GRID, linewidth=1.0)
    axes[0].set_xlabel("Odds ratio per 1 within-task SD")
    axes[0].set_yticks(y, labels)
    for position, model in zip(y, models, strict=True):
        axes[0].text(
            odds_high[list(y).index(position)] + 0.02,
            position,
            f"G={model['clusters']}, n={model['model_rows']}",
            va="center",
            fontsize=8.5,
            color=MUTED,
        )

    differences = np.array([model["standardized_probability_difference_pp"] for model in models])
    difference_low = np.array([model["standardized_probability_difference_95_ci_pp"][0] for model in models])
    difference_high = np.array([model["standardized_probability_difference_95_ci_pp"][1] for model in models])
    axes[1].errorbar(
        differences,
        y,
        xerr=np.vstack((differences - difference_low, difference_high - differences)),
        fmt="o",
        color=INK,
        ecolor=INK,
        linewidth=1.4,
        capsize=4,
        markersize=7,
    )
    axes[1].axvline(0, color=GRID, linewidth=1.0)
    axes[1].set_xlabel("Standardized fitted-probability difference · pp")
    axes[1].set_yticks(y)
    axes[1].set_yticklabels([])
    axes[0].set_title("Multiplicative parameterization", loc="left", fontsize=12.5, weight="bold", pad=13)
    axes[1].set_title("Absolute probability parameterization", loc="left", fontsize=12.5, weight="bold", pad=13)
    for axis in axes:
        axis.spines[["top", "right", "left"]].set_visible(False)
        axis.tick_params(axis="y", length=0, pad=9)
        axis.tick_params(axis="x", length=0, pad=7)
        axis.grid(axis="x")
        axis.set_axisbelow(True)
    figure.text(
        0.08,
        0.085,
        r"ESTIMAND · Common within-task slope $\beta$. Absolute contrast averages fitted probabilities at $z_i=-0.5$ and $+0.5$ equally across retained task intercepts.",
        color=MUTED,
        fontsize=8.5,
    )
    figure.text(
        0.08,
        0.046,
        "INFERENCE · CR1 task-clustered covariance with t critical values; rewrite-only uncertainty uses four identifying task clusters.",
        color=MUTED,
        fontsize=8.3,
    )
    figure.text(
        0.08,
        0.018,
        SCOPE_NOTE + " Excluded runs remain in published aggregates.",
        color=MUTED,
        fontsize=8.3,
    )
    save(figure, output, "10-code-size-model-estimates")


def write_run_data(rows: list[dict], output: Path) -> None:
    fields = (
        "run_id",
        "category",
        "report",
        "task",
        "configuration",
        "production_code_additions",
        "code_measure_source",
        "production_source_files",
        "passed",
        "checks",
        "success_rate",
        "centered_log1p_additions",
        "code_size_z",
    )
    with (output / "run-level-code-harness.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            record = {field: row.get(field, "") for field in fields}
            record["production_source_files"] = ";".join(row["production_source_files"])
            writer.writerow(record)


def write_task_table(rows: list[dict], output: Path) -> None:
    lines = [
        "# Production-code additions and harness outcomes",
        "",
        "Each run is weighted equally. Code additions are compared only after within-task transformation; raw line counts are not a cross-task complexity scale.",
        "",
        "| Category | Task | Runs | Runs with code | Median additions | Mean harness ratio | Outcome variation |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for category in ("debug", "rewrite"):
        for task in sorted({row["task"] for row in rows if row["category"] == category}):
            subset = [row for row in rows if row["task"] == task and row["category"] == category]
            observed = [row for row in subset if row["production_code_additions"] is not None]
            additions = [row["production_code_additions"] for row in observed]
            variation = "yes" if len({row["success_rate"] for row in observed}) > 1 else "no"
            median = "n/a" if not additions else f"{np.median(additions):,.1f}"
            mean = np.mean([row["success_rate"] for row in subset]) * 100
            lines.append(
                f"| {category} | `{task}` | {len(subset)} | {len(observed)} | {median} | {mean:.1f}% | {variation} |"
            )
    (output / "task-code-harness-table.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    config = load_analysis_config(args.config)
    global ANALYSIS_CONFIG, AGENT_ORDER, SOURCE_EXTENSIONS, EXCLUDED_PATH_PARTS
    global EXCLUDED_FILE_NAME_PATTERN, ARCHIVED_SOURCE_LINE_TASKS, SCOPE_NOTE
    ANALYSIS_CONFIG = config
    AGENT_ORDER = tuple(config["configurations"])
    SOURCE_EXTENSIONS = set(config["codeMetric"]["sourceExtensions"])
    EXCLUDED_PATH_PARTS = set(config["codeMetric"]["excludedPathParts"])
    EXCLUDED_FILE_NAME_PATTERN = re.compile(
        config["codeMetric"]["excludedFileNamePattern"]
    )
    ARCHIVED_SOURCE_LINE_TASKS = set(
        config["codeMetric"]["archivedEvaluatorSourceLineTasks"]
    )
    SCOPE_NOTE = scope_note(config)
    results_root = configured_path(config, "resultsRoot")
    model_output = configured_path(config, "outputs", "modelRuns")
    run_data = (
        repository_path(args.run_data)
        if args.run_data
        else model_output / "run-level-data.csv"
    )
    rewrite_reports = (
        tuple(repository_path(path) for path in args.rewrite_reports)
        if args.rewrite_reports
        else tuple(
            results_root / report["path"]
            for report in config["reports"]
            if report["category"] == "rewrite"
        )
    )
    output = (
        repository_path(args.output)
        if args.output
        else configured_path(config, "outputs", "harnessCode")
    )
    output.mkdir(parents=True, exist_ok=True)
    population = config["population"]
    rows = load_analysis_rows(
        run_data,
        rewrite_reports,
        results_root,
        int(population["relationshipRuns"]),
        int(population["rewriteSourceRuns"]),
    )
    transform = add_within_task_predictor(rows)
    models = [
        fit_fractional_logit(rows, "Pooled · task FE"),
        fit_fractional_logit(rows, "DeepSWE · task FE", category="debug"),
        fit_fractional_logit(rows, "Rewrite · task FE", category="rewrite"),
        fit_fractional_logit(rows, "Pooled · task + configuration FE", adjust_configuration=True),
    ]
    model_map = {"debug": models[1], "rewrite": models[2]}
    write_run_data(rows, output)
    write_task_table(rows, output)
    summary = {
        "analysis_population": {
            "published_harness_runs": int(population["sourceRuns"]),
            "relationship_runs": len(rows),
            "declared_exclusions": [
                f"{item['runId']} ({item['rounds']} rounds)"
                for item in config["relationshipExclusions"]
            ],
            "code_observed_runs": transform["observed_rows"],
            "code_missing_runs": [row["run_id"] for row in rows if row["production_code_additions"] is None],
        },
        "code_metric": {
            "source_extensions": sorted(SOURCE_EXTENSIONS),
            "excluded_path_parts": sorted(EXCLUDED_PATH_PARTS),
            "excluded_file_name_pattern": EXCLUDED_FILE_NAME_PATTERN.pattern,
            "archived_evaluator_source_line_tasks": sorted(ARCHIVED_SOURCE_LINE_TASKS),
            "debug": "Added lines in the final git patch for configured production-source files; configured test, fixture, harness, benchmark, example, and reference paths are excluded.",
            "rewrite": "Physical lines in configured production-source files in the retained submission, treated as additions from an empty target; configured archived-evaluator tasks use their source_lines field.",
            "missing": "Missing retained source remains missing and is never coded as zero.",
        },
        "response": "Run-level harness success ratio; every run contributes one equal-weight fractional-logit observation regardless of harness item count.",
        "predictor": {
            "definition": "z_i = [log(1 + additions_i) - task median log(1 + additions)] / pooled within-task SD",
            **transform,
        },
        "inference": "CR1 sandwich covariance clustered by task; two-sided 95% Wald intervals use t critical values with G-1 degrees of freedom.",
        "pricing_usd_per_1m_tokens": config["pricingUsdPer1mTokens"],
        "models": models,
    }
    if transform["observed_rows"] != int(population["codeObservedRuns"]):
        raise ValueError(
            f"Expected {population['codeObservedRuns']} code observations, "
            f"found {transform['observed_rows']}"
        )
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    configure_style(
        configured_path(config, "fonts", "regular"),
        configured_path(config, "fonts", "bold"),
    )
    plot_relationship(rows, model_map, output)
    plot_effects(models, output)
    print(json.dumps({"runs": len(rows), "code_observed": transform["observed_rows"], "models": [{"name": model["name"], "or": model["odds_ratio_per_sd"], "ci": model["odds_ratio_95_ci"], "p": model["cluster_robust_p"]} for model in models]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
