#!/usr/bin/env python3
"""Focused differential verifier for the supported benchmark surface."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path((ROOT / "REFERENCE_BINARY.txt").read_text(encoding="utf-8").strip())
PORT = ROOT / "executable"

CASES = [
    "1 + 2 * 3",
    "(10 - 4) / 3",
    "1..4 | to json -r",
    "[1 2 3] | math sum",
    "[1 2 3] | math avg",
    "[3 1 2] | math min",
    "[3 1 2] | math max",
    "'hello' | str upcase",
    "'HELLO' | str downcase",
    "'  hi  ' | str trim",
    "'banana' | str replace a X",
    "'abc' | str contains b",
    "[a B d C] | sort -i | to json -r",
    "{a: 1, b: x} | to json -r",
    "[[a b]; [1 x] [2 y]] | to json -r",
    "'{\"a\":1}' | from json | get a",
    "'a,b\\n1,x\\n2,y' | from csv | to json -r",
    "[[a b]; [1 x] [2 y]] | to csv",
    "[[lang gems]; [nu 100]] | reject gems | to json -r",
    "[1 2 3] | first 2 | to json -r",
    "[1 2 3] | get 1",
    "let x = [1 2 3]; $x | length",
]


def run(command: list[str], case: str) -> tuple[int, bytes, bytes]:
    result = subprocess.run(command + ["--no-config-file", "-c", case], cwd=ROOT, capture_output=True)
    return result.returncode, result.stdout, result.stderr


def main() -> int:
    failures = 0
    for case in CASES:
        expected = run([str(REFERENCE)], case)
        actual = run([sys.executable, str(PORT)], case)
        if expected != actual:
            failures += 1
            print(f"FAIL: {case}")
            print(f"  reference={expected!r}")
            print(f"  port={actual!r}")
    print(f"Differential cases: {len(CASES) - failures} passed, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
