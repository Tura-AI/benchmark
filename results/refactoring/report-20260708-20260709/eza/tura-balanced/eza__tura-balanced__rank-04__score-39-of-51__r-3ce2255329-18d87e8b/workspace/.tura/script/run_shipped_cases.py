#!/usr/bin/env python3
import os
import shlex
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OFFICIAL = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]
CASE_DIRS = [ROOT / "rust-reference" / "tests" / "cmd", ROOT / "rust-reference" / "tests" / "gen"]


def read_args(path):
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("args = "):
            return shlex.split(line.split("=", 1)[1].strip().strip('"'))
    return None


def run(cmd):
    env = os.environ.copy()
    env["NO_COLOR"] = "1"
    return subprocess.run(cmd, cwd=ROOT / "rust-reference", stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)


def safe(data):
    return data.decode("utf-8", "replace").encode("unicode_escape").decode("ascii")


def main():
    cases = []
    for d in CASE_DIRS:
        cases.extend(sorted(d.glob("*.toml")))
    failures = []
    skipped = 0
    for case in cases:
        argv = read_args(case)
        if not argv:
            continue
        # The Python port is targeted at the Windows binary in this workspace;
        # skip Unix/Nix golden cases whose source fixtures are absent here.
        if "tests/test_dir" in argv or "tests/timestamp_test_dir" in argv:
            skipped += 1
            continue
        official = run([str(OFFICIAL), *argv])
        actual = run([*PORT, *argv])
        if (official.returncode, official.stdout, official.stderr) != (actual.returncode, actual.stdout, actual.stderr):
            failures.append((case.name, argv, official, actual))
            if len(failures) >= 10:
                break
    if failures:
        for name, argv, official, actual in failures:
            print("CASE", name, argv)
            print("official", official.returncode, safe(official.stdout), safe(official.stderr))
            print("actual  ", actual.returncode, safe(actual.stdout), safe(actual.stderr))
        return 1
    print(f"ok {len(cases) - skipped} shipped cases, skipped {skipped} unavailable unix/nix fixture cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
