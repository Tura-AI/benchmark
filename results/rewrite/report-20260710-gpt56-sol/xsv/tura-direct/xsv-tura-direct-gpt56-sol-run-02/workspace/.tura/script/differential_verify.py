import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / "executable"

CASES = [
    ("headers basic", ["headers"], b"h1,h2\na,b\n"),
    ("headers names", ["headers", "--just-names"], b"h1,h2\na,b\n"),
    ("count", ["count"], b"h\na\nb\n"),
    ("count no headers", ["count", "--no-headers"], b"h\na\nb\n"),
    ("select index", ["select", "3,1"], b"a,b,c\n1,2,3\n4,5,6\n"),
    ("select range", ["select", "3-1"], b"a,b,c\n1,2,3\n"),
    ("select invert", ["select", "!2"], b"a,b,c\n1,2,3\n"),
    ("slice", ["slice", "--start", "1", "--len", "2"], b"h\na\nb\nc\n"),
    ("slice empty", ["slice", "--index", "9"], b"h\na\n"),
    ("search", ["search", "^foo"], b"a,b\nfoobar,x\nx,foobar\nno,no\n"),
    ("search select", ["search", "-s", "2", "^foo"], b"a,b\nfoobar,x\nx,foobar\n"),
    ("search invert", ["search", "-v", "x"], b"a,b\nx,y\na,b\n"),
    ("sort", ["sort"], b"a,b\nz,1\na,2\n"),
    ("sort selected", ["sort", "-s", "2"], b"a,b\nz,1\na,2\n"),
    ("sort numeric", ["sort", "-N"], b"n\n10\nno\n2\n"),
    ("sort reverse", ["sort", "-R", "--no-headers"], b"b\na\nc\n"),
    ("table", ["table"], b"h1,h2\nabcdefg,a\na,abc\n"),
    ("table condense", ["table", "--condense", "4"], b"h1,h2\nabcdefgh,x\n"),
    ("fmt tab", ["fmt", "-t", r"\t"], b"a,b\n1,2\n"),
    ("fmt quote", ["fmt", "--quote-always"], b"a,b\n1,2\n"),
    ("fmt crlf", ["fmt", "--crlf"], b"a,b\n1,2\n"),
    ("fmt ascii", ["fmt", "--ascii"], b"a,b\n1,2\n"),
    ("stats integer", ["stats"], b"n\n1\n2\n3\n"),
    ("stats types", ["stats"], b"i,f,s\n1,1.5,z\n2,2.5,a\n"),
    ("stats all", ["stats", "--everything"], b"i,s\n1,a\n2,b\n3,a\n"),
    ("stats nulls", ["stats", "--nulls"], b'n\n5\n""\n15\n10\n'),
    ("frequency", ["frequency", "--limit", "0"], b"h\na\na\nb\n"),
    ("frequency asc", ["frequency", "--asc", "--limit", "0"], b"h\na\na\nb\n"),
    ("frequency null", ["frequency", "--limit", "0"], b'h\na\n""\na\n'),
    ("bad selector", ["select", "9"], b"a,b\n1,2\n"),
    ("bad range", ["slice", "--start", "2", "--end", "1"], b"h\na\n"),
]


def run(command, args, data):
    return subprocess.run(command + args, input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, cwd=ROOT)


failures = []
for name, args, data in CASES:
    reference = run([str(REF)], args, data)
    port = run([sys.executable, str(PORT)], args, data)
    if (reference.returncode, reference.stdout, reference.stderr) != (
            port.returncode, port.stdout, port.stderr):
        failures.append((name, reference, port))

if failures:
    for name, reference, port in failures:
        print("FAIL", name)
        print("  ref:", reference.returncode, repr(reference.stdout), repr(reference.stderr))
        print("  new:", port.returncode, repr(port.stdout), repr(port.stderr))
    raise SystemExit(1)

print("31 differential cases passed")
