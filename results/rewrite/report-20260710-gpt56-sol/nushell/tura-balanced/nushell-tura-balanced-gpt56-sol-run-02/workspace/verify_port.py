#!/usr/bin/env python3
"""Byte-for-byte differential verifier for the benchmark compatibility surface."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
REFERENCE = Path((ROOT / "REFERENCE_BINARY.txt").read_text(encoding="utf-8").strip())


CASES = [
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "10 / 4",
    "10 // 4",
    "10 mod 4",
    "2 ** 8",
    "true and false",
    "not false",
    "null",
    '"hello"',
    "1..5 | math sum",
    "1..<5 | math sum",
    "[1 2 3] | length",
    "[1 2 3] | first",
    "[1 2 3] | last",
    "[1 2 3] | last 2",
    "[3 1 2] | sort",
    "[1 2 2 3] | uniq",
    "[1 2 3] | reverse",
    "[1 2 3] | append 4",
    "[1 2 3] | prepend 0",
    "[1 2 3] | each {|x| $x * 2 }",
    "[1 2 3] | where {|x| $x > 1 }",
    "[1 2 3] | where $it > 1",
    "let x = 4; $x + 3",
    "mut x = 1; $x += 2; $x",
    "if 2 > 1 { 'yes' } else { 'no' }",
    "[[name age]; [alice 30] [bob 25]]",
    "[[name age]; [alice 30] [bob 25]] | get name",
    "[[name age]; [alice 30] [bob 25]] | where age > 25",
    "[[name age]; [alice 30] [bob 25]] | sort-by age",
    "{a: 1, b: [2 3]} | to json",
    "{a: 1, b: [2 3]} | to json -r",
    "{a: 1, b: x} | to csv",
    '"a,b\\n1,2" | from csv | to json -r',
    "'{\"a\":1,\"b\":[2,3]}' | from json | get b.1",
    '"Hello World" | str downcase',
    '"hello world" | str upcase',
    '"  hi  " | str trim',
    '"abcabc" | str replace a x',
    '"a,b,c" | split row ,',
    '[hello world] | str join "-"',
    '"abcdef" | str substring 1..3',
    '"42" | into int',
    '42 | into string',
    "[1 2 3 4] | math avg",
    "[1 2 3 4] | math product",
    "[1 2 3 4] | math min",
    "[1 2 3 4] | math max",
    "1 +",
    "unknown-command",
    "1 / 0",
    "[1 2] | get 9",
    "error make {msg: boom}",
    "exit 7",
    "[1 2 3 4] | take 2 | to json -r",
    "[1 2 3 4] | skip 2 | to json -r",
    "[1 2 3 4] | drop 2 | to json -r",
    "{a: 1, b: 2} | columns | to json -r",
    "{a: 1, b: 2} | values | to json -r",
    '"a\\nb\\n" | lines | to json -r',
    '"stressed" | str reverse',
    '"hello world" | str capitalize',
    '"banana" | str index-of na',
    "-4 | math abs",
    "9 | math sqrt",
    "2.7 | math floor",
    "2.2 | math ceil",
]


def run(command: list[str], expression: str, cwd: Path, stdin: bytes = b"", extra: list[str] | None = None) -> subprocess.CompletedProcess[bytes]:
    env = os.environ.copy()
    env["NO_COLOR"] = "1"
    return subprocess.run(
        command + ["-n"] + (extra or []) + ["-c", expression],
        input=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=env,
        check=False,
    )


def entrypoint() -> list[str]:
    if os.name == "nt":
        return [str(ROOT / "executable.cmd")]
    return [str(ROOT / "executable")]


def compare_case(expression: str) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory(prefix="nu-port-ref-") as left_name, tempfile.TemporaryDirectory(
        prefix="nu-port-py-"
    ) as right_name:
        left, right = Path(left_name), Path(right_name)
        expected = run([str(REFERENCE)], expression, left)
        actual = run(entrypoint(), expression, right)
    exp = (expected.returncode, expected.stdout, expected.stderr)
    got = (actual.returncode, actual.stdout, actual.stderr)
    if exp == got:
        return True, ""
    return False, f"{expression!r}\n  expected={exp!r}\n  actual  ={got!r}"


def seed_files(path: Path) -> None:
    (path / "sample.txt").write_text("alpha\nbeta\n", encoding="utf-8")
    (path / "data.json").write_text('{"users":[{"name":"ada","age":30},{"name":"bob","age":20}]}', encoding="utf-8")
    (path / "data.csv").write_text("name,score\nada,9\nbob,7\n", encoding="utf-8")


def compare_isolated(expression: str, stdin: bytes = b"", extra: list[str] | None = None) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory(prefix="nu-port-ref-") as left_name, tempfile.TemporaryDirectory(prefix="nu-port-py-") as right_name:
        left, right = Path(left_name), Path(right_name)
        seed_files(left); seed_files(right)
        expected = run([str(REFERENCE)], expression, left, stdin, extra)
        actual = run(entrypoint(), expression, right, stdin, extra)
        left_files = sorted((p.relative_to(left).as_posix(), p.read_bytes()) for p in left.rglob("*") if p.is_file())
        right_files = sorted((p.relative_to(right).as_posix(), p.read_bytes()) for p in right.rglob("*") if p.is_file())
    exp = (expected.returncode, expected.stdout, expected.stderr, left_files)
    got = (actual.returncode, actual.stdout, actual.stderr, right_files)
    if exp == got: return True, ""
    return False, f"isolated {expression!r}\n  expected={exp!r}\n  actual  ={got!r}"


def main() -> int:
    failures = []
    for expression in CASES:
        matched, detail = compare_case(expression)
        if not matched:
            failures.append(detail)
    isolated = [
        ("open sample.txt | lines | length", b"", None),
        ("open data.json | get users.0.name", b"", None),
        ("open data.csv | get score | math sum", b"", None),
        ('"created" | save made.txt; open made.txt', b"", None),
        ("mkdir nested; touch nested/empty.txt; 'nested/empty.txt' | path exists", b"", None),
        ("$in | str trim | str upcase", b"  piped input  \n", ["--stdin"]),
        ("[1 2]", b"", ["--no-newline"]),
        ("42", b"", ["--no-newline"]),
        ("1 / 0", b"", ["--error-style", "plain"]),
    ]
    for expression, stdin, extra in isolated:
        matched, detail = compare_isolated(expression, stdin, extra)
        if not matched: failures.append(detail)
    if failures:
        print(f"{len(failures)}/{len(CASES) + len(isolated)} differential cases failed")
        print("\n".join(failures))
        return 1
    print(f"all {len(CASES) + len(isolated)} differential cases passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
