#!/usr/bin/env python3
"""Select a language- and difficulty-balanced DeepSWE v1.1 subset."""

from __future__ import annotations

import argparse
import json
import tomllib
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ARTIFACT_ROOT = "https://deepswe.datacurve.ai/artifacts/v1.1"
LANGUAGES = ("go", "python", "typescript", "rust", "javascript")
DIFFICULTY_BANDS = ("easy", "medium-easy", "medium-hard", "hard")
CANONICAL_TASKS_PATH = Path(__file__).with_name("canonical_tasks.json")


def load_url(name: str) -> dict:
    request = urllib.request.Request(
        f"{ARTIFACT_ROOT}/{name}.json",
        headers={"User-Agent": "tura-deep-swe-benchmark"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def load_task_toml(tasks_root: Path, task_id: str) -> dict:
    path = tasks_root / task_id / "task.toml"
    with path.open("rb") as handle:
        return tomllib.load(handle)


def load_canonical_tasks() -> dict:
    document = json.loads(CANONICAL_TASKS_PATH.read_text(encoding="utf-8"))
    if document.get("schema") != "tura.benchmark.deep-swe-canonical-task-set.v1":
        raise RuntimeError(f"invalid canonical task set: {CANONICAL_TASKS_PATH}")
    return document


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--task-ids",
        help="comma-separated ordered subset of the pinned canonical task IDs",
    )
    args = parser.parse_args()

    official_tasks = load_url("tasks")
    official_trials = load_url("trials")
    canonical = load_canonical_tasks()
    metadata = {row["id"]: row for row in official_tasks["rows"]}
    trials_by_task: dict[str, list[dict]] = defaultdict(list)
    for trial in official_trials["rows"]:
        if (
            trial.get("source") == "deep-swe"
            and trial.get("eval_scope") == "full"
            and trial.get("included_in_score") is True
        ):
            trials_by_task[trial["task_name"]].append(trial)

    rates: list[dict] = []
    for task_id, trials in trials_by_task.items():
        task = metadata[task_id]
        rates.append(
            {
                "task_id": task_id,
                "language": task["language"],
                "official_pass_rate": sum(bool(item.get("passed")) for item in trials) / len(trials),
                "official_scored_trials": len(trials),
                "official_error_trials": sum(bool(item.get("errored")) for item in trials),
            }
        )

    rates_by_task = {row["task_id"]: row for row in rates}
    rankings = {
        language: sorted(
            (row for row in rates if row["language"] == language),
            key=lambda row: (-row["official_pass_rate"], row["task_id"]),
        )
        for language in LANGUAGES
    }

    canonical_tasks = canonical["tasks"]
    if args.task_ids:
        requested = [task_id.strip() for task_id in args.task_ids.split(",") if task_id.strip()]
        if len(requested) != len(set(requested)):
            raise RuntimeError("--task-ids contains duplicate task IDs")
        canonical_ids = {task["task_id"] for task in canonical_tasks}
        unknown = [task_id for task_id in requested if task_id not in canonical_ids]
        if unknown:
            raise RuntimeError(f"--task-ids contains non-canonical tasks: {', '.join(unknown)}")
        requested_set = set(requested)
        canonical_tasks = [
            task for task in canonical_tasks if task["task_id"] in requested_set
        ]
        if [task["task_id"] for task in canonical_tasks] != requested:
            raise RuntimeError("--task-ids must follow canonical task order")

    selected: list[dict] = []
    for pinned in canonical_tasks:
        task_id = pinned["task_id"]
        language = pinned["language"]
        band = pinned["difficulty_band"]
        if task_id not in rates_by_task:
            raise RuntimeError(f"canonical task is missing official trials: {task_id}")
        chosen = dict(rates_by_task[task_id])
        if chosen["language"] != language:
            raise RuntimeError(
                f"canonical task language changed for {task_id}: "
                f"expected {language}, got {chosen['language']}"
            )
        language_rows = rankings[language]
        language_rank = next(
            index + 1
            for index, row in enumerate(language_rows)
            if row["task_id"] == task_id
        )
        band_index = DIFFICULTY_BANDS.index(band)
        start = band_index * len(language_rows) // len(DIFFICULTY_BANDS)
        end = (band_index + 1) * len(language_rows) // len(DIFFICULTY_BANDS)
        task_toml = load_task_toml(args.tasks_root, task_id)
        task_meta = task_toml["metadata"]
        environment = task_toml["environment"]
        chosen.update(
            {
                "difficulty_band": band,
                "language_rank": language_rank,
                "language_task_count": len(language_rows),
                "band_candidate_count": end - start,
                "display_title": task_meta["display_title"],
                "repository_url": task_meta["repository_url"],
                "base_commit_hash": task_meta["base_commit_hash"],
                "docker_image": environment["docker_image"],
                "cpus": environment["cpus"],
                "memory_mb": environment["memory_mb"],
                "storage_mb": environment["storage_mb"],
                "agent_timeout_sec": task_toml["agent"]["timeout_sec"],
                "verifier_timeout_sec": task_toml["verifier"]["timeout_sec"],
            }
        )
        selected.append(chosen)

    if not selected:
        raise RuntimeError("selection must contain at least one canonical task")
    if not args.task_ids:
        if len(selected) != 20:
            raise RuntimeError(f"selection must contain 20 tasks, got {len(selected)}")
        if Counter(row["language"] for row in selected) != Counter({name: 4 for name in LANGUAGES}):
            raise RuntimeError("selection is not balanced across languages")
        if Counter(row["difficulty_band"] for row in selected) != Counter({name: 5 for name in DIFFICULTY_BANDS}):
            raise RuntimeError("selection is not balanced across difficulty bands")

    document = {
        "schema": "tura.benchmark.deep-swe-selection.v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "benchmark": "datacurve-ai/deep-swe",
        "benchmark_version": "v1.1",
        "official_tasks_url": f"{ARTIFACT_ROOT}/tasks.json",
        "official_trials_url": f"{ARTIFACT_ROOT}/trials.json",
        "official_task_count": official_tasks["n_tasks"],
        "official_scored_trial_count": sum(len(items) for items in trials_by_task.values()),
        "selection_method": (
            "Use the pinned 20-task DeepSWE v1.1 benchmark inventory from "
            "deep_swe/canonical_tasks.json. Live official trial data updates statistics only and never "
            "changes task membership."
        ),
        "selection_source": "deep_swe/canonical_tasks.json",
        "selection_scope": "canonical-subset" if args.task_ids else "canonical-full",
        "canonical_task_count": len(canonical["tasks"]),
        "difficulty_bands": list(DIFFICULTY_BANDS),
        "languages": list(LANGUAGES),
        "tasks": selected,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "tasks": len(selected)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
