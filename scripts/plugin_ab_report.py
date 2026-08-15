from __future__ import annotations

import json
import statistics
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "analysis.json"
ARM_ORDER = ["no-plugin", "ponytail", "rtk", "caveman"]
PLUGIN_ARMS = ["ponytail", "rtk", "caveman"]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def mean(records: list[dict], *keys: str) -> float:
    values = []
    for record in records:
        value = record
        for key in keys:
            value = value[key]
        values.append(value)
    return statistics.mean(values)


def cost(record: dict, prices: dict[str, float]) -> float:
    usage = record["usage"]
    uncached = usage["input_tokens"] - usage["cached_input_tokens"]
    return (
        uncached * prices["uncached_input"]
        + usage["cached_input_tokens"] * prices["cached_input"]
        + usage["output_tokens"] * prices["output"]
    ) / 1_000_000


def aggregate(records: list[dict], prices: dict[str, float]) -> dict:
    total_tokens = sum(record["usage"]["total_tokens"] for record in records)
    cached_tokens = sum(
        record["usage"]["cached_input_tokens"] for record in records
    )
    return {
        "n": len(records),
        "mean_score": mean(records, "harness", "score"),
        "mean_passed": mean(records, "harness", "passed"),
        "mean_total_tokens": mean(records, "usage", "total_tokens"),
        "mean_cost_usd": statistics.mean(cost(record, prices) for record in records),
        "mean_rounds": mean(records, "llm_rounds"),
        "mean_duration_ms": mean(records, "duration_ms"),
        "cached_share_of_tokens_percent": cached_tokens / total_tokens * 100,
    }


def pair_variation(records: list[dict], prices: dict[str, float]) -> dict:
    assert len(records) == 2

    def summarize(values: list[float]) -> dict:
        low, high = min(values), max(values)
        average = statistics.mean(values)
        return {
            "min": low,
            "max": high,
            "max_to_min_ratio": high / low,
            "range_percent_of_mean": (high - low) / average * 100,
        }

    return {
        "total_tokens": summarize(
            [record["usage"]["total_tokens"] for record in records]
        ),
        "cost_usd": summarize([cost(record, prices) for record in records]),
        "rounds": summarize([record["llm_rounds"] for record in records]),
    }


def delta(arm: dict, baseline: dict) -> dict:
    def percent(key: str) -> float:
        return (arm[key] - baseline[key]) / baseline[key] * 100

    return {
        "score_percentage_points": (arm["mean_score"] - baseline["mean_score"])
        * 100,
        "total_tokens_percent": percent("mean_total_tokens"),
        "cost_percent": percent("mean_cost_usd"),
        "rounds_percent": percent("mean_rounds"),
        "duration_percent": percent("mean_duration_ms"),
    }


def fmt_percent(value: float) -> str:
    return f"{value:+.2f}%"


def build_readme(summary: dict) -> str:
    groups = summary["aggregates"]
    deltas = summary["deltas_vs_no_plugin_high"]
    lines = [
        "# Token-saving plugin eza runs",
        "",
        "This directory is the public, credential-free evidence package for the "
        "Ponytail/RTK/Caveman comparison cited by the token-saving-plugins article.",
        "",
        "All formal runs used the `source-port-python-default-eza` task, "
        "`gpt-5.6-sol`, High reasoning, and Codex CLI 0.144.1. The task asks "
        "the agent to rewrite the Rust eza repository as a Python implementation, "
        "then scores behavior with 52 harness assertions. Each arm contains two "
        "runs. The no-plugin pair was previously published with the same model, "
        "reasoning level, CLI, and task.",
        "",
        "## Group means",
        "",
        "| Arm | n | Harness score | Total tokens | Modeled cost | Rounds | Duration | Cached token share |",
        "| --- | -: | ------------: | -----------: | -----------: | -----: | -------: | -----------------: |",
    ]
    for name in ARM_ORDER:
        group = groups[name]
        lines.append(
            f"| {name} | {group['n']} | {group['mean_score'] * 100:.2f}% | "
            f"{group['mean_total_tokens']:,.0f} | ${group['mean_cost_usd']:.6f} | "
            f"{group['mean_rounds']:.1f} | {group['mean_duration_ms'] / 1000:.1f}s | "
            f"{group['cached_share_of_tokens_percent']:.2f}% |"
        )
    lines += [
        "",
        "## Relative to the no-plugin High baseline",
        "",
        "| Arm | Score | Total tokens | Modeled cost | Rounds | Duration |",
        "| --- | ----: | -----------: | -----------: | -----: | -------: |",
    ]
    for name in PLUGIN_ARMS:
        change = deltas[name]
        lines.append(
            f"| {name} | {change['score_percentage_points']:+.2f}pp | "
            f"{fmt_percent(change['total_tokens_percent'])} | "
            f"{fmt_percent(change['cost_percent'])} | "
            f"{fmt_percent(change['rounds_percent'])} | "
            f"{fmt_percent(change['duration_percent'])} |"
        )
    lines += [
        "",
        "## Variation between the two replicates",
        "",
        "Range / mean measures the gap between the two runs relative to their mean.",
        "",
        "| Arm | Token range / mean | Cost range / mean | Round range / mean |",
        "| --- | -----------------: | ----------------: | -----------------: |",
    ]
    for name in ARM_ORDER:
        variation = summary["within_arm_variation"][name]
        lines.append(
            f"| {name} | {variation['total_tokens']['range_percent_of_mean']:.2f}% | "
            f"{variation['cost_usd']['range_percent_of_mean']:.2f}% | "
            f"{variation['rounds']['range_percent_of_mean']:.2f}% |"
        )
    lines += [
        "",
        "Both Ponytail runs use full hook-and-skill activation. The matched RTK "
        "runs use the same plugin-run indices, r2/r3. Ponytail r1 was excluded "
        "because it was skill-only; RTK r1 was excluded by the same replicate-index "
        "rule rather than by its outcome. Both Caveman runs use 20 skills in separate "
        "isolated Codex homes plus the exact upstream primary skill body in global "
        "AGENTS.md, keeping the task prompt unchanged while guaranteeing activation. "
        "Caveman's Codex ChatGPT-login proxy path is metering-only, so this arm tests "
        "the skill package, not proxy input compression. The original Ponytail/RTK "
        "mean cost differences remain smaller than their within-arm variation; "
        "Caveman's two costs are closer together, but n=2 is still too small for "
        "an effect estimate. The "
        "samples are small, so these are descriptive "
        "differences, not significance or general-performance claims.",
        "",
        "## Files",
        "",
        "- `runs.json`: sanitized per-run observations for six plugin runs and two matched baselines.",
        "- `summary.json`: deterministic group means and baseline deltas generated from `runs.json`.",
        "- `methodology.json`: versions, pricing, isolation conditions, activation caveats, and provenance.",
        "- `round-activation-audit.jsonl`: one activation verdict per internal plugin-run round.",
        "",
        "Recompute the report without launching an agent:",
        "",
        "```sh",
        "npm run analysis:plugin-ab",
        "```",
        "",
        "The outer source-port suite records `ok: false` whenever any harness "
        "assertion fails. That is a score outcome, not a crashed agent run: all "
        "eight Codex processes exited 0 and produced complete usage and evaluator data.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    config = read_json(CONFIG_PATH)
    dataset_dir = ROOT / config["outputs"]["pluginAb"]
    dataset = read_json(dataset_dir / "runs.json")
    methodology = read_json(dataset_dir / "methodology.json")
    prices = {
        key: float(value)
        for key, value in config["pricingUsdPer1mTokens"].items()
    }

    records = dataset["runs"]
    expected_ids = {
        "ponytail-r2",
        "ponytail-r3",
        "rtk-r2",
        "rtk-r3",
        "caveman-r1",
        "caveman-r2",
        "no-plugin-high-r1",
        "no-plugin-high-r2",
    }
    assert {record["run"] for record in records} == expected_ids
    assert methodology["pricing_usd_per_million_tokens"] == prices
    assert all(record["codex_exit_code"] == 0 for record in records)

    grouped = {
        name: [record for record in records if record["arm"] == name]
        for name in ARM_ORDER
    }
    aggregates = {
        name: aggregate(group, prices) for name, group in grouped.items()
    }
    within_arm_variation = {
        name: pair_variation(group, prices) for name, group in grouped.items()
    }
    baseline = aggregates["no-plugin"]
    deltas = {
        name: delta(aggregates[name], baseline)
        for name in PLUGIN_ARMS
    }
    summary = {
        "schema": "tura.token-saving-plugin-eza-summary.v1",
        "task": dataset["task"],
        "model": dataset["model"],
        "reasoning": dataset["reasoning"],
        "codex_cli": dataset["codex_cli"],
        "pricing_usd_per_million_tokens": prices,
        "aggregates": aggregates,
        "deltas_vs_no_plugin_high": deltas,
        "within_arm_variation": within_arm_variation,
        "limitations": [
            "Each plugin arm and the matched baseline have n=2.",
            "Ponytail and RTK use matched replicate indices r2 and r3.",
            "Caveman uses both formal runs, r1 and r2, with forced primary-skill activation and no proxy compression.",
            "Results are descriptive and task-specific, not statistical significance claims.",
        ],
    }
    write_json(dataset_dir / "summary.json", summary)
    (dataset_dir / "README.md").write_text(build_readme(summary), encoding="utf-8")
    print(
        json.dumps(
            {
                "runs": len(records),
                "plugin_runs": len(records) - len(grouped["no-plugin"]),
                "output": dataset_dir.relative_to(ROOT).as_posix(),
            }
        )
    )


if __name__ == "__main__":
    main()
