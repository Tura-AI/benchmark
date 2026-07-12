#!/usr/bin/env python3
"""Differential checks against the benchmark-provided official executable."""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ["python", str(ROOT / "main.py")]
TIME = re.compile(rb"Time elapsed: .*\r?\n")


def call(command, args):
    return subprocess.run([*map(str, command), *args], cwd=ROOT, capture_output=True)


def stable(data):
    return TIME.sub(b"Time elapsed: <dynamic>\n", data)


CASES = [
    [], ["--version"], ["-h"], ["--help"],
    ["--help", "-i", "rust-reference/test-files/2.test.txt.zip"],
    ["--bogus"], ["-i", "missing.zip"], ["-i", "compile.sh", "-m", "a"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-w", "0"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-w", "nope"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--minPasswordLen", "0"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--maxPasswordLen", "0"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--minPasswordLen", "3", "--maxPasswordLen", "2"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-c", "x"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-m", "?z"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-m", ""],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-m", "?1?d"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-1", "abc"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-1", "a?", "-m", "?1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-p", "missing.txt"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-p", "rust-reference/test-files/generated-passwords-lowercase.txt", "-m", "a?l"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-s", "ab", "-m", "a?l"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-s", "AB", "-c", "l", "--minPasswordLen", "2", "--maxPasswordLen", "2"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-s", "a", "-c", "l", "--minPasswordLen", "2", "--maxPasswordLen", "2"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-m", "a?l", "-w", "1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-m", "?1?1", "-1", "ab", "-w", "1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--charsetFile", "rust-reference/test-files/file-charset.txt", "--minPasswordLen", "2", "--maxPasswordLen", "2", "-w", "1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-c", "l", "--minPasswordLen", "2", "--maxPasswordLen", "2", "--startingPassword", "ab", "-w", "1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "1", "-w", "1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-p", "rust-reference/test-files/generated-passwords-lowercase.txt", "-w", "1"],
    ["-i", "rust-reference/test-files/3.test.txt.zip", "-c", "l", "--minPasswordLen", "3", "--maxPasswordLen", "3", "-w", "1"],
    ["-i", "rust-reference/test-files/4.test.txt.zip", "-m", "abc?l", "-w", "1"],
    ["-i", "rust-reference/test-files/multi-file-with-dir.zip", "-m", "a?l", "-w", "1", "--fileNumber", "0"],
    ["-i", "rust-reference/test-files/multi-file-with-dir.zip", "-m", "a?l", "-w", "1", "--fileNumber", "1"],
    ["-i", "rust-reference/test-files/multi-file-with-dir.zip", "-m", "a?l", "-w", "1", "--fileNumber", "99"],
]


for args in CASES:
    expected, actual = call([REFERENCE], args), call(PORT, args)
    assert actual.returncode == expected.returncode, (args, expected.returncode, actual.returncode)
    assert stable(actual.stdout) == stable(expected.stdout), (args, expected.stdout, actual.stdout)
    assert actual.stderr == expected.stderr, (args, expected.stderr, actual.stderr)
print(f"{len(CASES)} differential cases passed")
