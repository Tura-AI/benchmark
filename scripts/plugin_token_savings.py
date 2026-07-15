#!/usr/bin/env python3
"""Estimate Ponytail and RTK token exposure from published benchmark evidence."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import tiktoken


PONYTAIL_CODE_SAVINGS_RATE = 0.54
PONYTAIL_SESSION_TOKEN_SAVINGS_RATE = 0.22
PONYTAIL_SESSION_COST_SAVINGS_RATE = 0.20

RTK_OPERATION_RATES = {
    "ls_tree": 0.80,
    "read": 0.70,
    "grep": 0.80,
    "git_status": 0.80,
    "git_diff": 0.75,
    "git_log": 0.80,
    "git_write": 0.92,
    "cargo_npm_test": 0.90,
    "ruff_check": 0.80,
    "pytest": 0.90,
    "go_test": 0.90,
    "docker_ps": 0.80,
}

RTK_OPERATION_LABELS = {
    "ls_tree": "ls / tree",
    "read": "cat / head / tail / rtk read",
    "grep": "grep / rg / rtk grep",
    "git_status": "git status",
    "git_diff": "git diff",
    "git_log": "git log",
    "git_write": "git add / commit / push",
    "cargo_npm_test": "cargo test / npm test",
    "ruff_check": "ruff check",
    "pytest": "pytest",
    "go_test": "go test",
    "docker_ps": "docker ps",
}

PONYTAIL_SOURCE = "https://github.com/DietrichGebert/ponytail"
PONYTAIL_BENCHMARK_SOURCE = (
    "https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/"
    "results/2026-06-18-agentic.md"
)
RTK_SOURCE = "https://github.com/rtk-ai/rtk"


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    category: str
    report: str
    configuration: str
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float
    source_path: str

    @property
    def key(self) -> tuple[str, str, str]:
        return self.configuration, self.report, self.run_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
    )
    parser.add_argument(
        "--configurations",
        nargs="+",
        help="Limit the analysis to the named agent groups.",
    )
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def load_runs(root: Path) -> list[RunRecord]:
    included = read_csv(root / "assets/model-run-statistics/run-level-data.csv")
    excluded = read_csv(root / "assets/model-run-statistics/excluded-runs.csv")
    long_tail = [
        row
        for row in excluded
        if row["exclusion_reason"] == "tura-balanced-rounds-over-90-long-tail"
    ]
    rows = included + long_tail
    records = [
        RunRecord(
            run_id=row["run_id"],
            category=row["category"],
            report=row["report"],
            configuration=row["agent_group"],
            input_tokens=int(row["input_tokens"]),
            cached_input_tokens=int(row["cached_input_tokens"]),
            output_tokens=int(row["output_tokens"]),
            total_tokens=int(row["total_tokens"]),
            cost_usd=float(row["cost_usd"]),
            source_path=row["source_path"].replace("\\", "/"),
        )
        for row in rows
    ]
    if len(records) != 280 or len({record.key for record in records}) != 280:
        raise ValueError("Expected 280 unique published harness runs")
    return records


def load_analysis_config(root: Path) -> dict:
    return json.loads((root / "config/analysis.json").read_text(encoding="utf-8"))


def is_production_source(path: str, config: dict) -> bool:
    code_config = config["codeMetric"]
    normalized = path.replace("\\", "/").lower()
    parts = normalized.split("/")
    suffix = Path(parts[-1]).suffix
    if suffix not in set(code_config["sourceExtensions"]):
        return False
    if any(part in set(code_config["excludedPathParts"]) for part in parts[:-1]):
        return False
    return re.search(code_config["excludedFileNamePattern"], parts[-1]) is None


def patch_added_code(
    patch: Path,
    config: dict,
    allowed_paths: set[str] | None = None,
) -> tuple[str, int, list[str]]:
    current_path: str | None = None
    in_hunk = False
    added_lines: list[str] = []
    included_paths: set[str] = set()
    for line in patch.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("diff --git "):
            current_path = None
            in_hunk = False
        elif line.startswith("+++ "):
            target = line[4:].split("\t", 1)[0]
            current_path = target[2:] if target.startswith("b/") else target
        elif line.startswith("@@"):
            in_hunk = True
        elif (
            in_hunk
            and current_path is not None
            and line.startswith("+")
            and (
                current_path in allowed_paths
                if allowed_paths is not None
                else is_production_source(current_path, config)
            )
        ):
            added_lines.append(line[1:])
            included_paths.add(current_path)
    return "\n".join(added_lines), len(added_lines), sorted(included_paths)


def run_directory(root: Path, run: RunRecord) -> Path:
    report = root / "results" / run.source_path
    if not report.exists():
        raise FileNotFoundError(report)
    return report.parents[2]


def count_code_tokens(
    root: Path,
    runs: list[RunRecord],
    tokenizer: tiktoken.Encoding,
    config: dict,
) -> list[dict]:
    metrics = {
        (row["configuration"], row["report"], row["run_id"]): row
        for row in read_csv(root / "assets/harness-code-statistics/run-level-code-harness.csv")
    }
    results: list[dict] = []
    for run in runs:
        metric = metrics.get(run.key)
        if metric is None and run.category != "debug":
            raise ValueError(f"Missing code metric for {run.run_id}")
        source_files = [
            value for value in metric["production_source_files"].split(";") if value
        ] if metric is not None else []
        expected_lines = (
            int(metric["production_code_additions"])
            if metric is not None and metric["production_code_additions"]
            else None
        )
        text: str | None = None
        observed_lines: int | None = None
        evidence = (
            metric["code_measure_source"]
            if metric is not None
            else "git-diff-production-additions"
        )
        reason = "observed"
        run_dir = run_directory(root, run)

        if run.category == "debug":
            patch = run_dir / "metadata/contracts/git-diff.patch"
            allowed = (
                {path.replace("\\", "/") for path in source_files}
                if metric is not None
                else None
            )
            text, observed_lines, observed_files = patch_added_code(
                patch,
                config,
                allowed,
            )
            if metric is None:
                source_files = observed_files
                expected_lines = observed_lines
        elif source_files and expected_lines is not None:
            chunks: list[str] = []
            observed_lines = 0
            for relative in source_files:
                source = run_dir / "workspace" / relative
                if not source.exists():
                    raise FileNotFoundError(source)
                content = source.read_text(encoding="utf-8", errors="replace")
                chunks.append(content)
                observed_lines += len(content.splitlines())
            text = "\n".join(chunks)
        else:
            reason = evidence

        if observed_lines is not None and observed_lines != expected_lines:
            raise ValueError(
                f"Code-line mismatch for {run.run_id}: "
                f"observed {observed_lines}, expected {expected_lines}"
            )
        code_tokens = len(tokenizer.encode(text)) if text is not None else None
        results.append(
            {
                "run_id": run.run_id,
                "category": run.category,
                "report": run.report,
                "configuration": run.configuration,
                "code_observed": text is not None,
                "missing_reason": "" if text is not None else reason,
                "production_code_lines": expected_lines,
                "production_code_tokens": code_tokens if code_tokens is not None else "",
                "run_total_tokens": run.total_tokens,
                "run_cost_usd": round(run.cost_usd, 9),
                "code_token_share_of_run": (
                    round(code_tokens / run.total_tokens, 9)
                    if code_tokens is not None and run.total_tokens
                    else ""
                ),
                "source_path": run.source_path,
            }
        )
    return results


RTK_PATTERNS = {
    "ls_tree": re.compile(r"(?<![\w.-])(?:rtk\s+)?(?:ls|tree)(?:\.exe)?(?=\s|$)", re.I),
    "read": re.compile(
        r"(?<![\w.-])(?:(?:rtk\s+read)|cat|head|tail)(?:\.exe)?(?=\s|$)", re.I
    ),
    "grep": re.compile(
        r"(?<![\w.-])(?:(?:rtk\s+grep)|grep|rg)(?:\.exe)?(?=\s|$)", re.I
    ),
    "git_status": re.compile(r"(?<![\w.-])git\s+status(?=\s|$)", re.I),
    "git_diff": re.compile(r"(?<![\w.-])git\s+diff(?=\s|$)", re.I),
    "git_log": re.compile(r"(?<![\w.-])git\s+log(?=\s|$)", re.I),
    "git_write": re.compile(r"(?<![\w.-])git\s+(?:add|commit|push)(?=\s|$)", re.I),
    "cargo_npm_test": re.compile(
        r"(?<![\w.-])(?:cargo\s+test|npm\s+(?:run\s+)?test)(?=\s|$)", re.I
    ),
    "ruff_check": re.compile(r"(?<![\w.-])ruff\s+check(?=\s|$)", re.I),
    "pytest": re.compile(r"(?<![\w.-])(?:python\s+-m\s+)?pytest(?=\s|$)", re.I),
    "go_test": re.compile(r"(?<![\w.-])go\s+test(?=\s|$)", re.I),
    "docker_ps": re.compile(r"(?<![\w.-])docker\s+ps(?=\s|$)", re.I),
}

SHELL_TOOL_NAMES = {"bash", "shell", "shell_command", "powershell.exe"}


def tool_command(tool: dict) -> str:
    arguments = tool.get("arguments")
    if not isinstance(arguments, dict):
        arguments = {}
    for key in ("command", "command_line", "input"):
        value = arguments.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return str(tool.get("commandLine") or "")


def tool_output(tool: dict) -> str:
    arguments = tool.get("arguments")
    if not isinstance(arguments, dict):
        return ""
    stdout = arguments.get("stdout")
    stderr = arguments.get("stderr")
    return "".join(value for value in (stdout, stderr) if isinstance(value, str))


def is_shell_execution(tool: dict, command: str) -> bool:
    name = str(tool.get("name") or "").lower()
    if name in SHELL_TOOL_NAMES:
        return True
    return name == "exec" and bool(
        re.search(r"tools\.(?:shell_command|bash|shell)\s*\(", command)
    )


def classify_rtk_operation(command: str) -> tuple[str | None, str]:
    matches = [
        name
        for name, pattern in RTK_PATTERNS.items()
        for _ in pattern.finditer(command)
    ]
    if len(matches) == 1:
        return matches[0], "eligible"
    if matches:
        return None, "mixed_rated_operations"
    return None, "no_rated_operation"


def compact_command(command: str, limit: int = 180) -> str:
    compact = re.sub(r"\s+", " ", command).strip()
    return compact if len(compact) <= limit else compact[: limit - 3] + "..."


def count_rtk_payloads(
    root: Path,
    runs: list[RunRecord],
    tokenizer: tiktoken.Encoding,
    uncached_input_rate: float,
) -> tuple[list[dict], dict]:
    aggregate: dict[str, dict] = {
        name: {
            "operation": name,
            "command_family": RTK_OPERATION_LABELS[name],
            "official_savings_rate": rate,
            "calls": 0,
            "output_tokens": 0,
            "estimated_saved_tokens": 0.0,
            "full_retention_saved_cost_usd": 0.0,
            "uniform_90_full_retention_saved_cost_usd": 0.0,
            "examples": [],
        }
        for name, rate in RTK_OPERATION_RATES.items()
    }
    diagnostics: Counter[str] = Counter()
    seen_tool_ids: set[tuple[str, str, str]] = set()

    for run in runs:
        rounds_path = run_directory(root, run) / "metadata/contracts/agent-rounds.jsonl"
        round_records = [
            json.loads(line)
            for line in rounds_path.read_text(encoding="utf-8").splitlines()
        ]
        last_round = max(
            (int(record.get("roundIndex") or 0) for record in round_records),
            default=0,
        )
        for round_record in round_records:
            tools = round_record.get("toolCalls") or []
            parent_ids = {
                str(tool.get("parentToolCallId"))
                for tool in tools
                if tool.get("parentToolCallId")
            }
            for index, tool in enumerate(tools):
                tool_id = str(tool.get("id") or f"index-{index}")
                unique_key = (
                    run.source_path,
                    str(round_record.get("roundId")),
                    tool_id,
                )
                if unique_key in seen_tool_ids:
                    raise ValueError(f"Duplicate tool call: {unique_key}")
                seen_tool_ids.add(unique_key)
                if tool_id in parent_ids:
                    diagnostics["parent_tool_calls_excluded"] += 1
                    continue
                output = tool_output(tool)
                if not output:
                    diagnostics["empty_output"] += 1
                    continue
                command = tool_command(tool)
                if not is_shell_execution(tool, command):
                    diagnostics["non_shell_tool"] += 1
                    continue
                operation, reason = classify_rtk_operation(command)
                if operation is None:
                    diagnostics[reason] += 1
                    continue
                output_tokens = len(tokenizer.encode(output))
                if output_tokens == 0:
                    diagnostics["zero_token_output"] += 1
                    continue
                target = aggregate[operation]
                target["calls"] += 1
                target["output_tokens"] += output_tokens
                target["estimated_saved_tokens"] += (
                    output_tokens * target["official_savings_rate"]
                )
                remaining_rounds = max(
                    0,
                    last_round - int(round_record.get("roundIndex") or 0),
                )
                if remaining_rounds:
                    retention_rate = uncached_input_rate + max(
                        0, remaining_rounds - 1
                    ) * 0.5
                    target["full_retention_saved_cost_usd"] += (
                        output_tokens
                        * target["official_savings_rate"]
                        * retention_rate
                        / 1_000_000
                    )
                    target["uniform_90_full_retention_saved_cost_usd"] += (
                        output_tokens * 0.9 * retention_rate / 1_000_000
                    )
                example = compact_command(command)
                if example not in target["examples"] and len(target["examples"]) < 3:
                    target["examples"].append(example)

    rows: list[dict] = []
    for name in RTK_OPERATION_RATES:
        item = aggregate[name]
        saved_tokens = item["estimated_saved_tokens"]
        rows.append(
            {
                "operation": name,
                "command_family": item["command_family"],
                "official_savings_rate": item["official_savings_rate"],
                "eligible_calls": item["calls"],
                "observed_output_tokens": item["output_tokens"],
                "estimated_saved_tokens": round(saved_tokens, 3),
                "observed_first_input_cost_usd": round(
                    item["output_tokens"] * uncached_input_rate / 1_000_000, 9
                ),
                "estimated_first_input_cost_saved_usd": round(
                    saved_tokens * uncached_input_rate / 1_000_000, 9
                ),
                "full_retention_saved_cost_usd": round(
                    item["full_retention_saved_cost_usd"], 9
                ),
                "uniform_90_full_retention_saved_cost_usd": round(
                    item["uniform_90_full_retention_saved_cost_usd"], 9
                ),
                "example_commands": " | ".join(item["examples"]),
            }
        )
    return rows, dict(sorted(diagnostics.items()))


def percent(value: float, denominator: float) -> float:
    return value / denominator * 100 if denominator else 0.0


def format_integer(value: float) -> str:
    return f"{value:,.0f}"


def format_percent(value: float) -> str:
    return f"{value:.4f}%"


def summarize(
    runs: list[RunRecord],
    code_rows: list[dict],
    rtk_rows: list[dict],
    rtk_diagnostics: dict,
    prices: dict[str, float],
) -> dict:
    total_tokens = sum(run.total_tokens for run in runs)
    total_cost = sum(run.cost_usd for run in runs)
    observed_code = [row for row in code_rows if row["code_observed"]]
    code_tokens = sum(int(row["production_code_tokens"]) for row in observed_code)
    covered_run_keys = {
        (row["configuration"], row["report"], row["run_id"])
        for row in observed_code
    }
    covered_tokens = sum(run.total_tokens for run in runs if run.key in covered_run_keys)
    covered_cost = sum(run.cost_usd for run in runs if run.key in covered_run_keys)
    ponytail_saved_code_tokens = code_tokens * PONYTAIL_CODE_SAVINGS_RATE
    code_output_cost = code_tokens * prices["output"] / 1_000_000
    ponytail_saved_code_cost = (
        ponytail_saved_code_tokens * prices["output"] / 1_000_000
    )

    rtk_output_tokens = sum(int(row["observed_output_tokens"]) for row in rtk_rows)
    rtk_saved_tokens = sum(float(row["estimated_saved_tokens"]) for row in rtk_rows)
    rtk_output_cost = sum(float(row["observed_first_input_cost_usd"]) for row in rtk_rows)
    rtk_saved_cost = sum(
        float(row["estimated_first_input_cost_saved_usd"]) for row in rtk_rows
    )
    rtk_full_retention_cost = sum(
        float(row["full_retention_saved_cost_usd"]) for row in rtk_rows
    )
    rtk_uniform_90_full_retention_cost = sum(
        float(row["uniform_90_full_retention_saved_cost_usd"])
        for row in rtk_rows
    )

    return {
        "population": {
            "published_harness_runs": len(runs),
            "configurations": sorted({run.configuration for run in runs}),
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 9),
            "input_tokens": sum(run.input_tokens for run in runs),
            "cached_input_tokens": sum(run.cached_input_tokens for run in runs),
            "output_tokens": sum(run.output_tokens for run in runs),
            "pricing_usd_per_million": prices,
        },
        "ponytail": {
            "official_claims": {
                "mean_code_savings_rate": PONYTAIL_CODE_SAVINGS_RATE,
                "mean_session_token_savings_rate": PONYTAIL_SESSION_TOKEN_SAVINGS_RATE,
                "mean_session_cost_savings_rate": PONYTAIL_SESSION_COST_SAVINGS_RATE,
            },
            "code_content_observation": {
                "covered_runs": len(observed_code),
                "missing_code_body_runs": len(code_rows) - len(observed_code),
                "covered_run_total_tokens": covered_tokens,
                "covered_run_cost_usd": round(covered_cost, 9),
                "production_code_tokens": code_tokens,
                "share_of_all_benchmark_tokens_percent": percent(code_tokens, total_tokens),
                "output_price_equivalent_usd": code_output_cost,
                "share_of_all_benchmark_cost_percent": percent(code_output_cost, total_cost),
            },
            "code_savings_scenario": {
                "estimated_saved_code_tokens": ponytail_saved_code_tokens,
                "share_of_all_benchmark_tokens_percent": percent(
                    ponytail_saved_code_tokens, total_tokens
                ),
                "output_price_equivalent_saved_usd": ponytail_saved_code_cost,
                "share_of_all_benchmark_cost_percent": percent(
                    ponytail_saved_code_cost, total_cost
                ),
            },
            "whole_session_vendor_rate_scenario": {
                "estimated_saved_tokens": total_tokens
                * PONYTAIL_SESSION_TOKEN_SAVINGS_RATE,
                "share_of_all_benchmark_tokens_percent": 22.0,
                "estimated_saved_cost_usd": total_cost
                * PONYTAIL_SESSION_COST_SAVINGS_RATE,
                "share_of_all_benchmark_cost_percent": 20.0,
            },
        },
        "rtk": {
            "eligible_command_output": {
                "eligible_calls": sum(int(row["eligible_calls"]) for row in rtk_rows),
                "observed_output_tokens": rtk_output_tokens,
                "share_of_all_benchmark_tokens_percent": percent(
                    rtk_output_tokens, total_tokens
                ),
                "first_input_cost_usd": rtk_output_cost,
                "share_of_all_benchmark_cost_percent": percent(
                    rtk_output_cost, total_cost
                ),
            },
            "operation_rate_scenario": {
                "estimated_saved_tokens": rtk_saved_tokens,
                "share_of_all_benchmark_tokens_percent": percent(
                    rtk_saved_tokens, total_tokens
                ),
                "estimated_first_input_cost_saved_usd": rtk_saved_cost,
                "share_of_all_benchmark_cost_percent": percent(
                    rtk_saved_cost, total_cost
                ),
                "weighted_savings_rate": (
                    rtk_saved_tokens / rtk_output_tokens if rtk_output_tokens else 0.0
                ),
                "full_retention_upper_saved_cost_usd": rtk_full_retention_cost,
                "full_retention_upper_cost_share_percent": percent(
                    rtk_full_retention_cost, total_cost
                ),
            },
            "uniform_90_percent_scenario": {
                "estimated_saved_tokens": rtk_output_tokens * 0.9,
                "share_of_all_benchmark_tokens_percent": percent(
                    rtk_output_tokens * 0.9, total_tokens
                ),
                "first_input_cost_saved_usd": (
                    rtk_output_tokens * 0.9 * prices["uncached_input"] / 1_000_000
                ),
                "first_input_cost_share_percent": percent(
                    rtk_output_tokens
                    * 0.9
                    * prices["uncached_input"]
                    / 1_000_000,
                    total_cost,
                ),
                "full_retention_upper_saved_cost_usd": (
                    rtk_uniform_90_full_retention_cost
                ),
                "full_retention_upper_cost_share_percent": percent(
                    rtk_uniform_90_full_retention_cost, total_cost
                ),
            },
            "diagnostics": rtk_diagnostics,
        },
    }


def report_markdown(summary: dict, rtk_rows: list[dict], code_rows: list[dict]) -> str:
    population = summary["population"]
    ponytail = summary["ponytail"]
    rtk = summary["rtk"]
    code = ponytail["code_content_observation"]
    code_savings = ponytail["code_savings_scenario"]
    session = ponytail["whole_session_vendor_rate_scenario"]
    rtk_load = rtk["eligible_command_output"]
    rtk_savings = rtk["operation_rate_scenario"]
    missing = Counter(
        row["missing_reason"] for row in code_rows if not row["code_observed"]
    )

    lines = [
        "# Ponytail and RTK: benchmark exposure and claim-rate scenarios",
        "",
        "## Conclusion",
        "",
        f"The {population['published_harness_runs']} published local harness runs contain "
        f"{format_integer(population['total_tokens'])} tokens and cost "
        f"${population['total_cost_usd']:.2f} under the repository pricing model. "
        "The table separates directly counted payloads from scenarios that apply vendor "
        "claim rates. The scenarios are not causal measurements of either plugin on this benchmark.",
        "",
        "| Plugin and scope | Attributable local payload | Payload / all tokens | Claim-rate scenario saving | Saving / all tokens | Price-equivalent saving | Saving / actual cost |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        f"| Ponytail: final production-code body ({code['covered_runs']} runs with recoverable code) | "
        f"{format_integer(code['production_code_tokens'])} | "
        f"{format_percent(code['share_of_all_benchmark_tokens_percent'])} | "
        f"{format_integer(code_savings['estimated_saved_code_tokens'])} at 54% less code | "
        f"{format_percent(code_savings['share_of_all_benchmark_tokens_percent'])} | "
        f"${code_savings['output_price_equivalent_saved_usd']:.4f} at output price | "
        f"{format_percent(code_savings['share_of_all_benchmark_cost_percent'])} |",
        f"| Ponytail: vendor whole-session average extrapolation | - | - | "
        f"{format_integer(session['estimated_saved_tokens'])} at 22% fewer session tokens | "
        f"22.0000% | ${session['estimated_saved_cost_usd']:.2f} at 20% lower cost | 20.0000% |",
        f"| RTK: uniquely classified command returns with an official per-command rate | "
        f"{format_integer(rtk_load['observed_output_tokens'])} | "
        f"{format_percent(rtk_load['share_of_all_benchmark_tokens_percent'])} | "
        f"{format_integer(rtk_savings['estimated_saved_tokens'])} | "
        f"{format_percent(rtk_savings['share_of_all_benchmark_tokens_percent'])} | "
        f"${rtk_savings['estimated_first_input_cost_saved_usd']:.4f} at first uncached input | "
        f"{format_percent(rtk_savings['share_of_all_benchmark_cost_percent'])} |",
        "",
        "## Ponytail",
        "",
        f"The current vendor result is 54% less code, session tokens at 78% of baseline "
        f"(22% less), and cost at 80% of baseline (20% less). Sources: "
        f"[README]({PONYTAIL_SOURCE}) and "
        f"[agentic benchmark]({PONYTAIL_BENCHMARK_SOURCE}).",
        "",
        f"The local production-code body contains {format_integer(code['production_code_tokens'])} "
        f"tokens measured with `o200k_base`. This covers {code['covered_runs']} runs. "
        f"The remaining {code['missing_code_body_runs']} runs have line counts or recovery records "
        "but not enough source body to tokenize, so their code tokens remain missing rather than "
        f"being guessed. Missing groups: {', '.join(f'{key}={value}' for key, value in sorted(missing.items()))}.",
        "",
        f"Applying the 54% less-code rate to the visible body yields "
        f"{format_integer(code_savings['estimated_saved_code_tokens'])} fewer code tokens. "
        f"The price-equivalent column values them at the ${population['pricing_usd_per_million']['output']:g}/M "
        "output rate because code is normally emitted in model output or tool arguments. It is not "
        "an independently traceable line on the provider bill.",
        "",
        "Ponytail's 22% token and 20% cost reductions are averages from its own Haiku 4.5 "
        "experiment over 12 feature tasks with n=4. Multiplying those rates by this benchmark "
        "only answers a transfer scenario; it does not establish that the result transfers to "
        "GPT-5.6-sol or to the DeepSWE and rewrite workloads.",
        "",
        "## RTK",
        "",
        f"RTK says common development-command output can be reduced by 60%-90% and publishes "
        f"per-operation estimates for a 30-minute session. This analysis uses only operations "
        f"with an explicit percentage in the [RTK README]({RTK_SOURCE}).",
        "",
        "| Command family | Uniquely classified calls | Observed return tokens | Official saving rate | Scenario saved tokens | First-input saving |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rtk_rows:
        lines.append(
            f"| `{row['command_family']}` | {row['eligible_calls']} | "
            f"{format_integer(row['observed_output_tokens'])} | "
            f"{float(row['official_savings_rate']) * 100:.0f}% | "
            f"{format_integer(float(row['estimated_saved_tokens']))} | "
            f"${float(row['estimated_first_input_cost_saved_usd']):.4f} |"
        )
    lines.extend(
        [
            "",
            f"The claim-rate-weighted scenario compression is "
            f"{rtk_savings['weighted_savings_rate'] * 100:.2f}%. Command returns are priced "
            "when they first enter the next model request as uncached input. The logs do not "
            "attribute each later cached replay to its original segment, so the analysis does "
            "not present cache-reuse savings as an exact bill reduction.",
            "",
            "Batches containing multiple rated operations are not allocated to one family. "
            "Commands without an official per-operation rate, such as `find`, general builds, "
            "and other linters, do not inherit the headline range. This is conservative for RTK "
            "but avoids double counting output that cannot be separated reliably.",
            "",
            "## Calculation boundaries",
            "",
            f"- The denominator is {population['published_harness_runs']} published harness runs "
            f"from {', '.join(population['configurations'])}. Totals come from "
            "`run-level-data.csv` and `excluded-runs.csv`.",
            "- Total tokens equal input plus output. Cached input is a subset of input and is not added twice.",
            "- Repository pricing is $5/M uncached input, $0.5/M cached input, and $30/M output.",
            "- Debug code is the added production-source body in the final git patch. Rewrite code "
            "is production-source body in the retained workspace. Existing code-metric rules "
            "exclude tests, fixtures, harnesses, benchmarks, and references.",
            "- Code tokens describe the unique final artifact body, not explanations, commands, "
            "overwritten drafts, or deletions. They measure retained code payload, not every token "
            "spent generating it.",
            "- RTK return tokens are stdout plus stderr from leaf shell calls in the agent-round "
            "contracts, deduplicated by call ID. A call is included only when it maps uniquely to "
            "a command family with an official rate.",
            "- Percentages use unrounded values; rounding is display-only.",
            "",
            "## Reproducible artifacts",
            "",
            "- `summary.json`: totals, shares, price scenarios, and diagnostic counts.",
            "- `ponytail-code-runs.csv`: per-run code-body tokens and missing-data reasons.",
            "- `rtk-operation-summary.csv`: per-family calls, return tokens, official rates, and scenario savings.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    config = load_analysis_config(root)
    configured_output = Path(config["outputs"]["pluginSavings"])
    requested_output = args.output or configured_output
    output = requested_output if requested_output.is_absolute() else root / requested_output
    output.mkdir(parents=True, exist_ok=True)

    runs = load_runs(root)
    selected_configurations = (
        args.configurations or config.get("pluginSavingsConfigurations")
    )
    if selected_configurations:
        selected = set(selected_configurations)
        known = {run.configuration for run in runs}
        unknown = selected - known
        if unknown:
            raise ValueError(f"Unknown configurations: {sorted(unknown)}")
        runs = [run for run in runs if run.configuration in selected]
    prices = {
        key: float(value)
        for key, value in config["pricingUsdPer1mTokens"].items()
    }
    tokenizer = tiktoken.get_encoding("o200k_base")
    code_rows = count_code_tokens(root, runs, tokenizer, config)
    rtk_rows, rtk_diagnostics = count_rtk_payloads(
        root,
        runs,
        tokenizer,
        prices["uncached_input"],
    )

    summary = summarize(runs, code_rows, rtk_rows, rtk_diagnostics, prices)
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_csv(
        output / "ponytail-code-runs.csv",
        code_rows,
        list(code_rows[0]),
    )
    write_csv(
        output / "rtk-operation-summary.csv",
        rtk_rows,
        list(rtk_rows[0]),
    )
    (output / "report.md").write_text(
        report_markdown(summary, rtk_rows, code_rows),
        encoding="utf-8",
    )
    print(
        f"plugin token analysis: {len(runs)} runs, "
        f"{summary['ponytail']['code_content_observation']['covered_runs']} code bodies, "
        f"{summary['rtk']['eligible_command_output']['eligible_calls']} RTK-eligible calls"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
