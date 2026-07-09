#!/usr/bin/env python3
import csv
import io
import os
import subprocess
import sys
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = [sys.executable, os.path.join(ROOT, "executable")]


def write_csv(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        csv.writer(f, lineterminator="\n").writerows(rows)


def check(args, files):
    with tempfile.TemporaryDirectory() as td:
        for name, rows in files.items():
            write_csv(os.path.join(td, name), rows)
        ref = subprocess.run([REF] + args, cwd=td, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        got = subprocess.run(PORT + args, cwd=td, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if normalize(args, ref) != normalize(args, got):
            print("case failed", args, file=sys.stderr)
            print("ref", ref.returncode, ref.stdout, ref.stderr, file=sys.stderr)
            print("got", got.returncode, got.stdout, got.stderr, file=sys.stderr)
            return False
    return True


def normalize(args, result):
    if args and args[0] == "frequency" and result.returncode == 0:
        rows = list(csv.reader(io.StringIO(result.stdout.decode("utf-8"))))
        if rows and rows[0] == ["field", "value", "count"]:
            return (result.returncode, rows[:1] + sorted(rows[1:]), result.stderr)
    return (result.returncode, result.stdout, result.stderr)


def main():
    ok = True
    ok &= check(["headers", "in1.csv"], {"in1.csv": [["h1", "h2"], ["a", "b"]]})
    ok &= check(["headers", "--just-names", "in1.csv"], {"in1.csv": [["h1", "h2"], ["a", "b"]]})
    ok &= check(["count", "in.csv"], {"in.csv": [["h"], ["a"], ["b"]]})
    select_rows = [["h1", "h2", "h[]3", "h4", "h1"], ["a", "b", "c", "d", "e"]]
    for sel in ["h1", "h1[1]", '"h[]3"', "h1-h4", "h1[1]-h1[0]", "!h1[1]-h2", "h4-,h1"]:
        ok &= check(["select", "--", sel, "data.csv"], {"data.csv": select_rows})
    slice_rows = [["header"], ["a"], ["b"], ["c"], ["d"], ["e"]]
    for args in [["slice", "--start", "1", "--end", "3", "in.csv"], ["slice", "--index", "1", "in.csv"], ["slice", "--start", "3", "in.csv"]]:
        ok &= check(args, {"in.csv": slice_rows})
    search_rows = [["h1", "h2"], ["foobar", "barfoo"], ["a", "b"], ["barfoo", "foobar"]]
    for args in [["search", "^foo", "data.csv"], ["search", "--ignore-case", "^FoO", "data.csv"], ["search", "--select", "h2", "^foo", "data.csv"], ["search", "--invert-match", "^foo", "data.csv"]]:
        ok &= check(args, {"data.csv": search_rows})
    sort_rows = [["N", "S"], ["10", "a"], ["LETTER", "b"], ["2", "c"], ["1", "d"]]
    for args in [["sort", "-N", "in.csv"], ["sort", "-R", "--no-headers", "in.csv"], ["sort", "--select", "2", "--no-headers", "in.csv"]]:
        ok &= check(args, {"in.csv": sort_rows})
    ok &= check(["table", "in.csv"], {"in.csv": [["h1", "h2", "h3"], ["abcdefg", "a", "a"], ["a", "abc", "z"]]})
    fmt_rows = [["h1", "h2"], ["abcdef", "ghijkl"], ["mnopqr", "stuvwx"]]
    for args in [["fmt", "--out-delimiter", "\t", "in.csv"], ["fmt", "--out-delimiter", "h", "in.csv"], ["fmt", "--crlf", "in.csv"], ["fmt", "--quote-always", "in.csv"]]:
        ok &= check(args, {"in.csv": fmt_rows})
    for args, rows in [
        (["stats", "in.csv"], [["header"], ["1"], ["2"]]),
        (["stats", "--median", "in.csv"], [["header"], ["1"], ["2"], ["3"]]),
        (["stats", "--mode", "in.csv"], [["header"], ["a"], ["b"], ["a"]]),
        (["stats", "--cardinality", "in.csv"], [["header"], ["a"], ["b"], ["a"]]),
    ]:
        ok &= check(args, {"in.csv": rows})
    freq_rows = [["h1", "h2"], ["a", "z"], ["a", "y"], ["a", "y"], ["b", "z"], ["", "z"], ["(NULL)", "x"]]
    for args in [["frequency", "--limit", "0", "--select", "h1", "in.csv"], ["frequency", "--no-nulls", "--limit", "0", "--select", "h1", "in.csv"], ["frequency", "--limit", "1", "in.csv"], ["frequency", "--limit", "1", "--select", "h2", "--asc", "in.csv"]]:
        ok &= check(args, {"in.csv": freq_rows})
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
