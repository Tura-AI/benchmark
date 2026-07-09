#!/usr/bin/env python3
import csv
import io
import os
import random
import shutil
import subprocess
import sys
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = [sys.executable, os.path.join(ROOT, "executable")]


def write_csv(path, rows, delimiter=","):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=delimiter, lineterminator="\n")
        w.writerows(rows)


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, text=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def compare(args, rows=None, stdin=None, delimiter=","):
    with tempfile.TemporaryDirectory() as td:
        if rows is not None:
            write_csv(os.path.join(td, "in.csv"), rows, delimiter)
            args = [a if a != "{input}" else "in.csv" for a in args]
        ref = run([REF] + args, td)
        got = run(PORT + args, td)
        if normalize(args, ref) != normalize(args, got):
            print("mismatch", args, file=sys.stderr)
            if rows is not None:
                print("rows", repr(rows), file=sys.stderr)
            print("ref", ref.returncode, ref.stdout, ref.stderr, file=sys.stderr)
            print("got", got.returncode, got.stdout, got.stderr, file=sys.stderr)
            return False
        return True


def normalize(args, result):
    if args and args[0] == "frequency" and result.returncode == 0:
        rows = list(csv.reader(io.StringIO(result.stdout.decode("utf-8"))))
        if rows and rows[0] == ["field", "value", "count"]:
            return (result.returncode, rows[:1] + sorted(rows[1:]), result.stderr)
    if args and args[0] == "stats" and result.returncode == 0 and ("--mode" in args or "--everything" in args):
        rows = list(csv.reader(io.StringIO(result.stdout.decode("utf-8"))))
        if rows and "mode" in rows[0]:
            idx = rows[0].index("mode")
            for row in rows[1:]:
                if idx < len(row):
                    row[idx] = "<mode>"
            return (result.returncode, rows, result.stderr)
    return (result.returncode, result.stdout, result.stderr)


def rand_field(rng):
    alphabet = ["", " ", "a", "b", "z", "1", "2", "10", "1.5", "x,y", 'x"y', "é", "(NULL)"]
    return rng.choice(alphabet)


def rand_rows(rng, headers=True):
    cols = rng.randint(1, 5)
    rows = []
    if headers:
        rows.append(["h%d" % (i + 1) for i in range(cols)])
    for _ in range(rng.randint(0, 12)):
        rows.append([rand_field(rng) for _ in range(cols)])
    if not rows:
        rows.append(["h1"])
    return rows


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or os.urandom(8))
    cases = []
    commands = ["headers", "count", "select", "slice", "search", "sort", "table", "fmt", "stats", "frequency"]
    for cmd in commands:
        for _ in range(16):
            rows = rand_rows(rng, headers=True)
            if cmd == "headers":
                args = [cmd, "{input}"]
            elif cmd == "count":
                args = [cmd, rng.choice(["{input}", "--no-headers"])]
                if args[-1] == "--no-headers":
                    args.append("{input}")
            elif cmd == "select":
                sel = rng.choice(["1", "1-", "-1", "!1", "h1", "1,1"])
                args = [cmd, "--", sel, "{input}"]
            elif cmd == "slice":
                args = [cmd, rng.choice(["--start", "--len", "--index"]), str(rng.randint(0, 3)), "{input}"]
            elif cmd == "search":
                args = [cmd] + rng.choice([["a"], ["-i", "A"], ["-v", "zzz"], ["-s", "1", "a"]]) + ["{input}"]
            elif cmd == "sort":
                args = [cmd] + rng.choice([[], ["-R"], ["-N"], ["-s", "1"]]) + ["{input}"]
            elif cmd == "table":
                args = [cmd] + rng.choice([[], ["-w", "1"], ["-p", "4"], ["-c", "2"]]) + ["{input}"]
            elif cmd == "fmt":
                args = [cmd] + rng.choice([[], ["-t", "\t"], ["--quote-always"], ["--crlf"]]) + ["{input}"]
            elif cmd == "stats":
                args = [cmd] + rng.choice([[], ["--median"], ["--mode"], ["--cardinality"], ["--everything"], ["--nulls"]]) + ["{input}"]
            else:
                freq_opts = [[], ["--limit", "0"], ["--asc"], ["--no-nulls"], ["-s", "1"]]
                args = [cmd] + rng.choice(freq_opts) + ["{input}"]
            cases.append((args, rows))
        invalids = [[cmd, "--definitely-not-a-real-flag"], [cmd, "-d", "too-long", "{input}"], [cmd, "-d", "é", "{input}"]]
        if cmd not in ("search", "select"):
            invalids.append([cmd, "missing.csv"])
        elif cmd == "search":
            invalids.append([cmd, "[", "{input}"])
        else:
            invalids.append([cmd, "999", "{input}"])
        for bad in invalids:
            cases.append((list(bad), rand_rows(rng, headers=True)))
    ok = True
    for args, rows in cases:
        ok = compare(args, rows) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
