#!/usr/bin/env python3
"""Focused byte-for-byte verifier for the benchmarked xsv commands."""

import os
import pathlib
import subprocess
import sys
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
REFERENCE = pathlib.Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]

CASES = [
    (["headers"], b"h1,h2\na,b\n"),
    (["headers", "--just-names"], b"h1,h2\na,b\n"),
    (["count"], b"h1,h2\na,b\nc,d\n"),
    (["count", "--no-headers"], b"h1,h2\na,b\nc,d\n"),
    (["select", "3-1"], b"a,b,c\n1,2,3\n"),
    (["select", "--no-headers", "2"], b"a,b\nc,d\n"),
    (["slice", "--start", "1", "--len", "1"], b"h1,h2\na,1\nb,2\n"),
    (["search", "-i", "^foo"], b"h1,h2\nFOO,a\nb,foo\nx,y\n"),
    (["search", "-v", "x"], b"h\nx\ny\n"),
    (["sort"], b"h,n\nb,10\na,2\n"),
    (["sort", "-N", "--select", "2"], b"h,n\na,10\nb,2\n"),
    (["table"], b"h1,h2\nabcdef,a\nx,zzz\n"),
    (["table", "--condense", "2"], b"h1,h2\nabcdef,a\n"),
    (["fmt", "--out-delimiter", r"\t"], b"h1,h2\na,b\n"),
    (["fmt", "--quote-always"], b"h1,h2\na,b\n"),
    (["stats"], b"name,n\na,1\nb,2\nc,3\n"),
    (["stats", "--everything"], b"name,n\na,1\nb,2\nc,3\n"),
    (["frequency"], b"name,n\na,1\na,1\nb,2\n"),
    (["frequency", "--asc", "--no-nulls"], b"name\na\na\nb\n\n"),
]


def invoke(command, argv, data, cwd):
    return subprocess.run(command + argv, input=data, cwd=cwd,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    failures = []
    with tempfile.TemporaryDirectory() as directory:
        for argv, data in CASES:
            reference = invoke([str(REFERENCE)], argv, data, directory)
            port = invoke(PORT, argv, data, directory)
            observed = (port.returncode, port.stdout, port.stderr)
            expected = (reference.returncode, reference.stdout, reference.stderr)
            if observed != expected:
                failures.append((argv, expected, observed))
    if failures:
        for argv, expected, observed in failures:
            print("FAIL", " ".join(argv))
            print("  reference:", repr(expected))
            print("  port:     ", repr(observed))
        return 1
    print("{} differential cases passed".format(len(CASES)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
