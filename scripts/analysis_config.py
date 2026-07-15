"""Load and validate the shared statistical-analysis configuration."""

from __future__ import annotations

import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = REPOSITORY_ROOT / "config" / "analysis.json"


def repository_path(value: str | Path) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (REPOSITORY_ROOT / path).resolve()


def load_analysis_config(path: str | Path = DEFAULT_CONFIG_PATH) -> dict:
    config_path = repository_path(path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("schema") != "tura.benchmark.analysis-config.v1":
        raise ValueError(f"Unsupported analysis configuration: {config_path}")

    reports = config.get("reports") or []
    population = config.get("population") or {}
    expected_source_runs = sum(int(report["expectedRuns"]) for report in reports)
    if expected_source_runs != int(population.get("sourceRuns", -1)):
        raise ValueError(
            "Configured report counts do not equal population.sourceRuns: "
            f"{expected_source_runs} != {population.get('sourceRuns')}"
        )
    exclusions = config.get("relationshipExclusions") or []
    if expected_source_runs - len(exclusions) != int(population.get("relationshipRuns", -1)):
        raise ValueError("Configured exclusions do not produce population.relationshipRuns")
    if len({report["path"] for report in reports}) != len(reports):
        raise ValueError("Analysis report paths must be unique")
    if len({item["runId"] for item in exclusions}) != len(exclusions):
        raise ValueError("Analysis exclusion run IDs must be unique")
    return config


def configured_path(config: dict, *keys: str) -> Path:
    value = config
    for key in keys:
        value = value[key]
    return repository_path(value)
