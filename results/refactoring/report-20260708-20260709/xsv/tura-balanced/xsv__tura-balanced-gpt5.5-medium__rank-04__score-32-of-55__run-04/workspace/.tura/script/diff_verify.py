#!/usr/bin/env python3
import csv
import os
import random
import shutil
import string
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "xsv_port.py")]


def run(cmd, cwd, stdin=b""):
    try:
        p = subprocess.run(cmd, cwd=cwd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        return 124, e.stdout or b"", (e.stderr or b"") + b"TIMEOUT\n"


def write_csv(path, rows, delim=","):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=delim)
        w.writerows(rows)


def cell(rng):
    alphabet = string.ascii_letters + string.digits + " _-.()"
    if rng.randrange(12) == 0:
        return ""
    if rng.randrange(10) == 0:
        return str(rng.randint(-200, 200))
    if rng.randrange(10) == 0:
        return str(round(rng.uniform(-50, 50), 2))
    return "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 12)))


def valid_rows(rng, min_cols=1, max_cols=6, min_records=0, max_records=24):
    cols = rng.randint(min_cols, max_cols)
    n = rng.randint(min_records, max_records)
    header = ["h{}".format(i + 1) for i in range(cols)]
    rows = [header]
    for _ in range(n):
        rows.append([cell(rng) for _ in range(cols)])
    return rows


def invalid_rows(rng):
    rows = valid_rows(rng, 2, 5, 2, 8)
    bad = rng.randrange(1, len(rows))
    rows[bad] = rows[bad][:-1]
    return rows


def frequency_rows(rng):
    cols = rng.randint(1, 4)
    rows = [["h{}".format(i + 1) for i in range(cols)]]
    for r in range(12):
        row = []
        for c in range(cols):
            if r < 6:
                row.append("major{}".format(c))
            elif r < 9:
                row.append("minor{}".format(c))
            elif r < 11:
                row.append("rare{}".format(c))
            else:
                row.append(cell(rng) or "tail{}".format(c))
        rows.append(row)
    return rows


def compare(name, args, rows, invalid=False, stdin=None, ext=".csv"):
    with tempfile.TemporaryDirectory() as td:
        wd = Path(td)
        if rows is not None:
            path = wd / ("in" + ext)
            write_csv(path, rows, "\t" if ext == ".tsv" else ",")
            args = args + [str(path)]
        oracle = run([str(REF)] + args, wd, stdin or b"")
        actual = run(PORT + args, wd, stdin or b"")
        if oracle != actual:
            sys.stderr.write("FAIL {} {}\n".format(name, args))
            sys.stderr.write("oracle={}\nactual={}\n".format(oracle, actual))
            return False
    return True


def samples(seed):
    rng = random.Random(seed)
    interfaces = ["headers", "count", "select", "slice", "search", "sort", "table", "fmt", "stats", "frequency"]
    total = 0
    for iface in interfaces:
        for i in range(16):
            rows = frequency_rows(rng) if iface == "frequency" else valid_rows(rng)
            cols = len(rows[0]) if rows else 1
            if iface == "headers":
                args = ["headers", "--just-names"] if i % 3 == 0 else ["headers"]
            elif iface == "count":
                args = ["count"] + (["--no-headers"] if i % 2 else [])
            elif iface == "select":
                sel = "1" if cols == 1 else rng.choice(["1", "1-{}".format(cols), "!1", "h1", "h{}".format(cols)])
                args = ["select", sel]
            elif iface == "slice":
                start = rng.randint(0, max(0, len(rows) - 1))
                args = ["slice", "--start", str(start), "--len", str(rng.randint(0, 5))]
            elif iface == "search":
                args = ["search", rng.choice(["a", "^[0-9-]", "z", "(?i)a"])]
            elif iface == "sort":
                args = ["sort"] + (rng.choice([["-N"], ["-R"], ["--select", "1"], []]))
            elif iface == "table":
                args = ["table"] + (rng.choice([[], ["--width", "1"], ["--pad", "4"], ["--condense", "3"]]))
            elif iface == "fmt":
                args = ["fmt"] + (rng.choice([[], ["--quote-always"], ["--out-delimiter", "\t"], ["--crlf"]]))
            elif iface == "stats":
                args = ["stats"] + (rng.choice([[], ["--median"], ["--mode"], ["--cardinality"], ["--everything"], ["--nulls"]]))
            else:
                args = ["frequency"] + (rng.choice([[], ["--limit", "0"], ["--asc"], ["--no-nulls"], ["--select", "1"]]))
            if not compare(iface, args, rows):
                return False
            total += 1
        for i in range(4):
            rows = valid_rows(rng)
            if iface == "headers":
                args = ["headers", "--delimiter", "xx"]
            elif iface == "count":
                args = ["count", "--delimiter", "xx"]
            elif iface == "select":
                args = ["select", rng.choice(["999", "0", '"h1', "h1[abc]"])]
            elif iface == "slice":
                args = ["slice", "--start", "4", "--end", "2"]
            elif iface == "search":
                args = ["search", "--delimiter", "xx", "a"]
            elif iface == "sort":
                args = ["sort", "--select", "999"]
            elif iface == "table":
                args = ["table", "--delimiter", "xx"]
            elif iface == "fmt":
                args = ["fmt", "--out-delimiter", "xx"]
            elif iface == "stats":
                args = ["stats", "--select", "999"]
            else:
                args = ["frequency", "--select", "999"]
            if not compare(iface + " invalid", args, rows, invalid=True):
                return False
            total += 1
    print("differential verifier passed {} generated cases seed={}".format(total, seed))
    return True


if __name__ == "__main__":
    seed = os.environ.get("VERIFIER_SEED") or str(random.randrange(1 << 30))
    raise SystemExit(0 if samples(seed) else 1)
