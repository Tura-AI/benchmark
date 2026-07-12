#!/usr/bin/env python3
"""Focused differential verifier for deterministic CLI surfaces."""

import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
REFERENCE = (ROOT / "REFERENCE_BINARY.txt").read_text().strip()
PORT = [sys.executable, str(ROOT / "executable")]
ZIP2 = "rust-reference/test-files/2.test.txt.zip"
ZIP3 = "rust-reference/test-files/3.test.txt.zip"
MULTI = "rust-reference/test-files/multi-file-with-dir.zip"
CASES = [
    [], ["-h"], ["--help"], ["--version"], ["-i", "missing.zip"],
    ["-i", ZIP2, "-w", "x"], ["-i", ZIP2, "-w", "0"],
    ["-i", ZIP2, "--minPasswordLen", "0"],
    ["-i", ZIP2, "--minPasswordLen", "3", "--maxPasswordLen", "2"],
    ["-i", ZIP2, "-m", "?z"], ["-i", ZIP2, "-m", "?1"],
    ["-i", ZIP2, "-1", "abc"],
    ["-i", ZIP2, "-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "2", "-w", "1"],
    ["-i", ZIP3, "-m", "abc", "-w", "1"],
    ["-i", ZIP2, "-c", "d", "--minPasswordLen", "1", "--maxPasswordLen", "1", "-w", "1"],
    ["-i", MULTI, "-m", "wrong", "-w", "1"],
]


def run(command, args):
    return subprocess.run(command + args, cwd=ROOT, capture_output=True, timeout=30)


def normalized(data):
    text = data.decode(errors="replace").replace("\r\n", "\n")
    return re.sub(r"Time elapsed: .*\n", "Time elapsed: <dynamic>\n", text)


def main():
    failures = []
    for args in CASES:
        expected = run([REFERENCE], args)
        actual = run(PORT, args)
        left = (expected.returncode, normalized(expected.stdout), normalized(expected.stderr))
        right = (actual.returncode, normalized(actual.stdout), normalized(actual.stderr))
        if left != right:
            failures.append((args, left, right))
    if failures:
        for args, expected, actual in failures:
            print(f"FAIL {args!r}\n  reference={expected!r}\n  port={actual!r}")
        return 1
    print(f"PASS: {len(CASES)} differential cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
