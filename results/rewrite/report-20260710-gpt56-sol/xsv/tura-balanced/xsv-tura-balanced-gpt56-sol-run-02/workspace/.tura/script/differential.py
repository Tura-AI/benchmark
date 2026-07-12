#!/usr/bin/env python3
"""Black-box differential verifier for the requested xsv command surface."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]


CASES = [
    ("headers-basic", ["headers", "data.csv"], b"h1,h2\na,b\n"),
    ("headers-names", ["headers", "-j", "data.csv"], b"h1,h2\na,b\n"),
    ("count", ["count", "data.csv"], b"h1,h2\na,b\nc,d\n"),
    ("count-no-head", ["count", "-n", "data.csv"], b"h1,h2\na,b\n"),
    ("select", ["select", "h2,h1", "data.csv"], b"h1,h2\na,b\n"),
    ("select-range", ["select", "!2-3", "data.csv"], b"a,b,c,d\n1,2,3,4\n"),
    ("slice", ["slice", "-s", "1", "-l", "1", "data.csv"], b"h\na\nb\nc\n"),
    ("search", ["search", "^a", "-s", "h2", "data.csv"], b"h1,h2\na,abc\nb,zzz\n"),
    ("search-invert", ["search", "-iv", "FOO", "data.csv"], b"h1,h2\nfoo,x\nbar,y\n"),
    ("sort", ["sort", "-R", "-s", "2", "data.csv"], b"h1,h2\na,2\nb,10\nc,1\n"),
    ("sort-numeric", ["sort", "-N", "-s", "2", "data.csv"], b"h1,h2\na,2\nb,10\nc,1\n"),
    ("table", ["table", "-p", "3", "data.csv"], b"h1,h2\nabcdef,x\na,yyy\n"),
    ("table-condense", ["table", "-c", "2", "data.csv"], "h\nabcdef\n	3\u00a93\u00a93\n".encode()),
    ("fmt-tab", ["fmt", "-t", "\\t", "data.csv"], b'h1,h2\n"a,b","x""y"\n'),
    ("fmt-quotes", ["fmt", "--quote-always", "data.csv"], b"a,b\n1,2\n"),
    ("frequency", ["frequency", "-l", "0", "data.csv"], b"h1,h2\na,x\na,y\nb,y\n"),
    ("frequency-options", ["frequency", "-a", "-l", "1", "--no-nulls", "data.csv"], b"h1,h2\na,\na,x\nb,x\n"),
    ("stats", ["stats", "data.csv"], b"n,s\n1,a\n2,bb\n3,a\n"),
    ("stats-all", ["stats", "--everything", "data.csv"], b"n,s\n1,a\n2,bb\n3,a\n"),
    ("delimiter", ["select", "-d", ";", "2", "data.csv"], b"a;b\n1;2\n"),
    ("quoted", ["slice", "data.csv"], b'h1,h2\n"a\nb","c,d"\n'),
    ("empty", ["count", "data.csv"], b""),
    ("stdin", ["count"], b"h\na\nb\n"),
    ("bad-select", ["select", "0", "data.csv"], b"h\na\n"),
    ("bad-range", ["slice", "-s", "2", "-e", "1", "data.csv"], b"h\na\n"),
]

SELECT_DATA = b"h1,h2,h[]3,h4,h1\na,b,c,d,e\n"
for number, selection in enumerate([
    "h1", "h1[0]", "h1[1]", '"h[]3"', '"h[]3"[0]', "h1-h4",
    'h1-h2,"h[]3"-h4', "h1[1]-h1[0]", '!"h[]3"[0]', "!h1[1]-h2",
    "h1,h1", "h1-h2,h2-h1", "h4-", "-h2", "h4-,h1", "-h2,h1[1]",
]):
    separator = ["--"] if selection.startswith("-") else []
    CASES.append((f"select-source-{number}", ["select"] + separator + [selection, "data.csv"], SELECT_DATA))

for number, selection in enumerate([
    "dne", "0", "6", "1[0]", "h1[2]", "h1[2.0]", "h1[a]", '"h1',
    '"h1"[1', "a-b-",
]):
    CASES.append((f"select-error-{number}", ["select", selection, "data.csv"], SELECT_DATA))

for number, args in enumerate([
    ["slice"], ["slice", "-s", "0", "-e", "1"], ["slice", "-s", "1", "-e", "3"],
    ["slice", "-e", "1"], ["slice", "-s", "3"], ["slice", "-i", "1"],
    ["slice", "-n", "-s", "1", "-l", "2"], ["slice", "-e", "2", "-l", "1"],
    ["slice", "-i", "1", "-s", "1"], ["slice", "-s", "99"],
]):
    CASES.append((f"slice-source-{number}", args + ["data.csv"], b"h\na\nb\nc\nd\ne\n"))

SEARCH_DATA = b"h1,h2\nfoobar,barfoo\na,b\nbarfoo,foobar\n"
for number, args in enumerate([
    ["search", "^foo"], ["search", "-i", "^FoO"], ["search", "-v", "^foo"],
    ["search", "-s", "h2", "^foo"], ["search", "-n", "-s", "2", "^foo"],
    ["search", "a|z"], ["search", "["], ["search", "^$"],
]):
    CASES.append((f"search-source-{number}", args + ["data.csv"], SEARCH_DATA))

SORT_DATA = b"N,S\n10,a\nLETTER,b\n2,c\n1,d\n8.33,e\n3.3,f\n"
for number, args in enumerate([
    ["sort"], ["sort", "-R"], ["sort", "-N"], ["sort", "-NR"],
    ["sort", "-s", "S"], ["sort", "-n", "-s", "2"],
]):
    CASES.append((f"sort-source-{number}", args + ["data.csv"], SORT_DATA))

FMT_DATA = b'h1,h2\n"a,b","x""y"\nline,"a\nb"\n'
for number, args in enumerate([
    ["fmt"], ["fmt", "--crlf"], ["fmt", "--ascii"], ["fmt", "-t", "h"],
    ["fmt", "--quote", "'"], ["fmt", "--quote-always"],
    ["fmt", "--escape", "\\"], ["fmt", "-d", ",", "-t", "\\t"],
]):
    CASES.append((f"fmt-source-{number}", args + ["data.csv"], FMT_DATA))

TABLE_DATA = "h1,h2,h3\nabcdefg,a,a\na,abc,z\n,b,c\n".encode()
for number, args in enumerate([
    ["table"], ["table", "-w", "5"], ["table", "-p", "0"],
    ["table", "-c", "0"], ["table", "-c", "2"],
]):
    CASES.append((f"table-source-{number}", args + ["data.csv"], TABLE_DATA))

FREQ_DATA = b"h1,h2\na,z\na,y\na,y\nb,z\n,z\n(NULL),x\n"
for number, args in enumerate([
    ["frequency", "-l", "1"],
    ["frequency", "-s", "h2", "-l", "0"],
]):
    CASES.append((f"frequency-source-{number}", args + ["data.csv"], FREQ_DATA))

STATS_DATA = b"n,mixed,text,empty\n1,1.5,a,\n2,2,bb,\n3,,a,\n4,hello,z,\n"
for number, args in enumerate([
    ["stats"], ["stats", "--median"], ["stats", "--mode"],
    ["stats", "--cardinality"], ["stats", "--everything"],
    ["stats", "--everything", "--nulls"], ["stats", "-s", "n,text"],
    ["stats", "-n"], ["stats", "-j", "1"],
]):
    CASES.append((f"stats-source-{number}", args + ["data.csv"], STATS_DATA))

for number, (args, data) in enumerate([
    (["count", "data.tsv"], b"h1\th2\na\tb\n"),
    (["headers", "data.csv", "second.csv"], b"h1,h2\na,b\n"),
    (["headers", "--intersect", "data.csv", "second.csv"], b"h1,h2\na,b\n"),
    (["count", "-d", "xx", "data.csv"], b"h\na\n"),
    (["count", "-d", "", "data.csv"], b"h\na\n"),
    (["count", "--bogus", "data.csv"], b"h\na\n"),
    (["count", "missing.csv"], b""),
    (["select", "-o", "result.csv", "2", "data.csv"], b"h1,h2\na,b\n"),
    (["fmt", "-o", "result.csv", "--crlf", "data.csv"], b"h1,h2\na,b\n"),
    (["stats", "-o", "result.csv", "data.csv"], b"n\n1\n2\n"),
    (["count", "data.csv"], b"h1,h2\na\n"),
    (["fmt", "data.csv"], b'h1,h2\n"unterminated,x\n'),
    (["select", "", "data.csv"], b"h1,h2\na,b\n"),
    (["select", "!", "data.csv"], b"h1,h2\na,b\n"),
    (["stats", "data.csv"], b"h\n"),
    (["frequency", "data.csv"], b"h\n"),
]):
    CASES.append((f"boundary-{number}", args, data))


def invoke(command: list[str], args: list[str], stdin: bytes, cwd: Path):
    proc = subprocess.run(command + args, input=stdin, cwd=cwd, capture_output=True)
    files = {}
    for path in cwd.iterdir():
        if path.is_file() and path.name != "data.csv":
            files[path.name] = path.read_bytes()
    return proc.returncode, proc.stdout, proc.stderr, files


def frequency_rows(command: list[str], args: list[str], cwd: Path):
    result = invoke(command, args, b"", cwd)
    code, stdout, stderr, files = result
    lines = stdout.splitlines()
    return code, lines[:1] + sorted(lines[1:]), stderr, files


def main() -> int:
    failures = []
    with tempfile.TemporaryDirectory(prefix="xsv-diff-") as raw:
        base = Path(raw)
        for name, args, data in CASES:
            left = base / (name + "-ref")
            right = base / (name + "-port")
            left.mkdir()
            right.mkdir()
            (left / "data.csv").write_bytes(data)
            (right / "data.csv").write_bytes(data)
            if "data.tsv" in args:
                (left / "data.tsv").write_bytes(data)
                (right / "data.tsv").write_bytes(data)
            if "second.csv" in args:
                (left / "second.csv").write_bytes(b"h2,h3\ny,z\n")
                (right / "second.csv").write_bytes(b"h2,h3\ny,z\n")
            stdin = data if name == "stdin" else b""
            expected = invoke([str(REFERENCE)], args, stdin, left)
            actual = invoke(PORT, args, stdin, right)
            if expected != actual:
                failures.append({"case": name, "expected": repr(expected), "actual": repr(actual)})

        # Equal-count frequency rows are randomized by the reference hash map.
        # Compare their full row multiset while preserving all other bytes.
        for number, tied_args in enumerate([
            ["frequency", "-l", "0", "data.csv"],
            ["frequency", "-a", "-l", "0", "data.csv"],
            ["frequency", "--no-nulls", "-l", "0", "data.csv"],
            ["frequency", "-n", "-s", "1", "-l", "0", "data.csv"],
        ]):
            left = base / f"frequency-ties-{number}-ref"
            right = base / f"frequency-ties-{number}-port"
            left.mkdir()
            right.mkdir()
            (left / "data.csv").write_bytes(FREQ_DATA)
            (right / "data.csv").write_bytes(FREQ_DATA)
            expected = frequency_rows([str(REFERENCE)], tied_args, left)
            actual = frequency_rows(PORT, tied_args, right)
            if expected != actual:
                failures.append({"case": f"frequency-ties-{number}", "expected": repr(expected), "actual": repr(actual)})
    if failures:
        print(json.dumps(failures, indent=2), file=sys.stderr)
        return 1
    print(f"differential: {len(CASES)} cases passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
