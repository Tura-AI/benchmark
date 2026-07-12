#!/usr/bin/env python3
"""Differential compatibility checks for the benchmark command surface."""

from __future__ import annotations

import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
CANDIDATE = [sys.executable, str(ROOT / "xsv_port.py")]


def run(argv: list[str], stdin: bytes, cwd: Path, reference: bool) -> tuple[int, bytes, bytes]:
    command = ([str(REFERENCE)] if reference else CANDIDATE) + argv
    result = subprocess.run(
        command,
        input=stdin,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=os.environ.copy(),
    )
    return result.returncode, result.stdout, result.stderr


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="xsv-port-") as raw_tmp:
        tmp = Path(raw_tmp)
        (tmp / "basic.csv").write_bytes(
            b'name,num,mix,blank\na,10,1.5,\nb,2,x," "\na,3,4.5,\na,2,1.5,\n'
        )
        (tmp / "indexed.csv").write_bytes(b"h,n\na,1\na,1\nb,2\n")
        subprocess.run([str(REFERENCE), "index", "indexed.csv"], cwd=tmp, check=True)
        (tmp / "other.csv").write_bytes(b"num,extra\n8,z\n")
        (tmp / "quoted.csv").write_bytes(
            b'name,note\nalpha,"comma, quote "" and newline\ninside"\nbeta,plain\n'
        )
        (tmp / "data.tsv").write_bytes(b"left\tright\nx\ty\n")
        (tmp / "frequency.csv").write_bytes(
            b"value\na\na\na\na\nb\nb\nb\nc\nc\nd\n"
        )
        (tmp / "duplicates.csv").write_bytes(b"a,a,c\n1,2,3\n")
        (tmp / "empty.csv").write_bytes(b"")
        (tmp / "many.csv").write_bytes(
            b"h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12\n"
        )

        cases: list[tuple[list[str], bytes]] = [
            ([], b""),
            (["--version"], b""),
            (["--help"], b""),
            (["--list"], b""),
            (["help"], b""),
            (["headers", "--help"], b""),
            (["count", "--help"], b""),
            (["select", "--help"], b""),
            (["slice", "--help"], b""),
            (["search", "--help"], b""),
            (["sort", "--help"], b""),
            (["table", "--help"], b""),
            (["fmt", "--help"], b""),
            (["stats", "--help"], b""),
            (["frequency", "--help"], b""),
            (["headers", "basic.csv"], b""),
            (["headers", "-j", "basic.csv"], b""),
            (["headers", "--intersect", "basic.csv", "other.csv"], b""),
            (["headers", "many.csv"], b""),
            (["count", "basic.csv"], b""),
            (["count", "-n"], b"a,b\n1,2\n"),
            (["select", "3-1,2", "basic.csv"], b""),
            (["select", "!blank", "basic.csv"], b""),
            (["select", "a[1]", "duplicates.csv"], b""),
            (["select", "-", "duplicates.csv"], b""),
            (["select", "a[2]", "duplicates.csv"], b""),
            (["select", "name", "-n", "duplicates.csv"], b""),
            (["select", "1", "empty.csv"], b""),
            (["slice", "-s", "1", "-l", "2", "basic.csv"], b""),
            (["slice", "--index", "0", "quoted.csv"], b""),
            (["search", "^a", "basic.csv"], b""),
            (["search", "-i", "-s", "name", "ALPHA", "quoted.csv"], b""),
            (["sort", "basic.csv"], b""),
            (["sort", "-N", "-s", "num", "basic.csv"], b""),
            (["sort", "-R", "data.tsv"], b""),
            (["table", "basic.csv"], b""),
            (["table", "-c", "3", "quoted.csv"], b""),
            (["table", "-w", "5", "basic.csv"], b""),
            (["table", "-p", "4", "basic.csv"], b""),
            (["fmt", "-t", r"\t", "quoted.csv"], b""),
            (["fmt", "--crlf", "basic.csv"], b""),
            (["fmt", "--ascii", "basic.csv"], b""),
            (["fmt", "--quote-always", "basic.csv"], b""),
            (["stats", "basic.csv"], b""),
            (["stats", "--everything", "basic.csv"], b""),
            (["stats", "--nulls", "-s", "num", "basic.csv"], b""),
            (["stats", "empty.csv"], b""),
            (["stats", "--mode", "empty.csv"], b""),
            (["frequency", "-l", "2", "frequency.csv"], b""),
            (["frequency", "-a", "-l", "2", "frequency.csv"], b""),
            (["frequency", "empty.csv"], b""),
            (["count", "--delimiter", "::", "basic.csv"], b""),
            (["select", "99", "basic.csv"], b""),
            (["slice", "-s", "3", "-e", "2", "basic.csv"], b""),
            (["count", "--output", "x", "basic.csv"], b""),
            (["headers", "--no-headers", "basic.csv"], b""),
            (["fmt", "--numeric", "basic.csv"], b""),
            (["stats", "--limit", "2", "basic.csv"], b""),
            (["count", "indexed.csv"], b""),
            (["slice", "-i", "1", "indexed.csv"], b""),
            (["stats", "indexed.csv"], b""),
            (["frequency", "-l", "2", "indexed.csv"], b""),
        ]

        rng = random.Random(7628)
        values = ["", "0", "1", "-2", "3.5", "alpha", "beta", "z"]
        for fixture_index in range(10):
            name = f"generated-{fixture_index}.csv"
            lines = ["left,middle,right"]
            for _ in range(rng.randint(2, 8)):
                lines.append(",".join(rng.choice(values) for _ in range(3)))
            (tmp / name).write_text("\n".join(lines) + "\n", newline="")
            cases.extend([
                (["count", name], b""),
                (["count", "-n", name], b""),
                (["select", "3-1,2", name], b""),
                (["slice", "-s", "1", "-l", "3", name], b""),
                (["search", "^(alpha|3)", name], b""),
                (["sort", "-s", "middle,right", name], b""),
                (["sort", "-N", "-s", "left", name], b""),
                (["fmt", "-t", r"\t", name], b""),
                (["table", "-c", "4", name], b""),
                (["stats", name], b""),
            ])

        failures = 0
        for argv, stdin in cases:
            expected = run(argv, stdin, tmp, True)
            actual = run(argv, stdin, tmp, False)
            if actual != expected:
                failures += 1
                print(f"FAIL {' '.join(argv)}")
                print(f"  status: {actual[0]} != {expected[0]}")
                if actual[1] != expected[1]:
                    print(f"  stdout: {actual[1]!r} != {expected[1]!r}")
                if actual[2] != expected[2]:
                    print(f"  stderr: {actual[2]!r} != {expected[2]!r}")

        output_cases = [
            ["select", "name,num", "-o", "result.csv", "basic.csv"],
            ["slice", "-i", "1", "-o", "result.csv", "basic.csv"],
            ["search", "a", "-o", "result.csv", "basic.csv"],
            ["sort", "-N", "-s", "num", "-o", "result.csv", "basic.csv"],
            ["table", "-o", "result.csv", "basic.csv"],
            ["fmt", "--crlf", "-o", "result.csv", "basic.csv"],
            ["stats", "--everything", "-o", "result.csv", "basic.csv"],
            ["frequency", "-l", "2", "-o", "result.csv", "frequency.csv"],
        ]
        for argv in output_cases:
            target = tmp / "result.csv"
            target.unlink(missing_ok=True)
            expected = run(argv, b"", tmp, True)
            expected_file = target.read_bytes() if target.exists() else None
            target.unlink(missing_ok=True)
            actual = run(argv, b"", tmp, False)
            actual_file = target.read_bytes() if target.exists() else None
            if actual != expected or actual_file != expected_file:
                failures += 1
                print(f"FAIL {' '.join(argv)}")
                print(f"  process: {actual!r} != {expected!r}")
                print(f"  file: {actual_file!r} != {expected_file!r}")

        stale = tmp / "stale.csv"
        stale.write_bytes(b"h\na\n")
        subprocess.run([str(REFERENCE), "index", "stale.csv"], cwd=tmp, check=True)
        time.sleep(1.1)
        stale.write_bytes(b"h\na\nb\n")
        stale_cases = [
            ["count", "stale.csv"],
            ["slice", "-i", "0", "stale.csv"],
            ["stats", "stale.csv"],
            ["frequency", "stale.csv"],
        ]
        for argv in stale_cases:
            expected = run(argv, b"", tmp, True)
            actual = run(argv, b"", tmp, False)
            if actual != expected:
                failures += 1
                print(f"FAIL {' '.join(argv)}")
                print(f"  process: {actual!r} != {expected!r}")

        total = len(cases) + len(output_cases) + len(stale_cases)
        passed = total - failures
        print(f"differential: {passed}/{total} passed")
        return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
