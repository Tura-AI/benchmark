import csv
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]


def rng():
    return random.Random(os.environ.get("VERIFIER_SEED") or str(random.randrange(1 << 30)))


def gen_rows(r, header=True, min_rows=1, max_rows=8, cols=None):
    cols = cols or r.randint(1, 5)
    alphabet = ["", "a", "b", "x", "y", "z", "1", "2", "10", "1.5", "hello", "with space", "a,b", 'q"q']
    rows = []
    if header:
        rows.append(["h%d" % (i + 1) for i in range(cols)])
    for _ in range(r.randint(min_rows, max_rows)):
        rows.append([r.choice(alphabet) for _ in range(cols)])
    return rows


def write_csv(path, rows, delimiter=","):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=delimiter, lineterminator="\n")
        w.writerows(rows)


def run(cmd, cwd, stdin=b""):
    p = subprocess.run(cmd, cwd=cwd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout, p.stderr


def both(args, cwd, stdin=b""):
    a = run([str(REF)] + args, cwd, stdin)
    b = run(PORT + args, cwd, stdin)
    if a != b:
        raise AssertionError("mismatch args=%r\nref=%r\nport=%r" % (args, a, b))


def valid_cases(command, r, tmp):
    cases = []
    for i in range(16):
        rows = gen_rows(r, header=True)
        if command == "frequency":
            cols = r.randint(1, 4)
            rows = [["h%d" % (j + 1) for j in range(cols)]]
            for j in range(12):
                row = []
                for c in range(cols):
                    if j < 6:
                        row.append("v%d_a" % c)
                    elif j < 10:
                        row.append("v%d_b" % c)
                    else:
                        row.append("v%d_c" % c)
                rows.append(row)
        path = tmp / ("%s_%02d.csv" % (command, i))
        write_csv(path, rows)
        fname = path.name
        if command == "headers":
            opts = [[], ["--just-names"], ["-j"]][i % 3]
            cases.append(opts + [fname])
        elif command == "count":
            cases.append((["--no-headers"] if i % 2 else []) + [fname])
        elif command == "select":
            n = len(rows[0])
            sel = ["1", "1-%d" % n, "!1", "h1", "%d-1" % n][i % 5]
            cases.append((["--no-headers"] if i % 4 == 0 else []) + [sel if i % 4 == 0 else sel.replace("h1", "1") if False else sel, fname])
            if i % 4 == 0:
                cases[-1][1] = "1"
        elif command == "slice":
            start = r.randint(0, 3); length = r.randint(0, 3)
            opts = [["--start", str(start)], ["--start", str(start), "--len", str(length)], ["--index", str(start)], ["--end", str(start + length)]][i % 4]
            cases.append(opts + (["--no-headers"] if i % 3 == 0 else []) + [fname])
        elif command == "search":
            opts = [["a"], ["-i", "A"], ["-v", "zzzz"], ["-s", "1", "a"]][i % 4]
            if i % 5 == 0:
                opts = ["--no-headers"] + opts
            cases.append(opts + [fname])
        elif command == "sort":
            opts = [[], ["-N"], ["-R"], ["-s", "1"]][i % 4]
            if i % 3 == 0:
                opts = ["--no-headers"] + opts
            cases.append(opts + [fname])
        elif command == "table":
            opts = [[], ["--width", "1"], ["--pad", "4"], ["--condense", "2"]][i % 4]
            cases.append(opts + [fname])
        elif command == "fmt":
            opts = [[], ["--out-delimiter", "\t"], ["--quote-always"], ["--crlf"], ["--ascii"]][i % 5]
            cases.append(opts + [fname])
        elif command == "stats":
            opts = [[], ["--median"], ["--mode"], ["--cardinality"], ["--everything"], ["--nulls"]][i % 6]
            if i % 4 == 0:
                opts = ["--no-headers"] + opts
            cases.append(opts + [fname])
        elif command == "frequency":
            opts = [[], ["--limit", "0"], ["--asc"], ["--no-nulls"], ["-s", "1"]][i % 5]
            if i % 4 == 0:
                opts = ["--no-headers"] + opts
            cases.append(opts + [fname])
    return [[command] + c for c in cases]


def invalid_cases(command, r, tmp):
    rows = gen_rows(r, header=True, cols=2)
    path = tmp / ("bad_%s.csv" % command)
    write_csv(path, rows)
    f = path.name
    base = {
        "headers": [["--delimiter", "xx", f], ["-d", "é", f], ["-", "-"], ["missing.csv"]],
        "count": [["--delimiter", "xx", f], ["-d", "é", f], ["missing.csv"], ["--bad", f]],
        "select": [["0", f], ["99", f], ["dne", f], ["h1[99]", f]],
        "slice": [["--index", "1", "--start", "0", f], ["--end", "1", "--len", "1", f], ["--start", "3", "--end", "1", f], ["--start", "x", f]],
        "search": [["[", f], ["-s", "99", "a", f], ["-d", "xx", "a", f], ["a", "missing.csv"]],
        "sort": [["-s", "99", f], ["-d", "xx", f], ["missing.csv"], ["--bad", f]],
        "table": [["--width", "x", f], ["-d", "xx", f], ["missing.csv"], ["--condense", "x", f]],
        "fmt": [["--out-delimiter", "xx", f], ["--quote", "xx", f], ["missing.csv"], ["-d", "xx", f]],
        "stats": [["-s", "99", f], ["-d", "xx", f], ["missing.csv"], ["--jobs", "x", f]],
        "frequency": [["-s", "99", f], ["-d", "xx", f], ["missing.csv"], ["--limit", "x", f]],
    }[command]
    return [[command] + c for c in base]


def main():
    r = rng()
    commands = ["headers", "count", "select", "slice", "search", "sort", "table", "fmt", "stats", "frequency"]
    with tempfile.TemporaryDirectory(prefix="xsv-diff-") as td:
        tmp = Path(td)
        shutil.copy(ROOT / "executable", tmp / "executable")
        shutil.copy(ROOT / "xsv_port.py", tmp / "xsv_port.py")
        total = 0
        for command in commands:
            for args in valid_cases(command, r, tmp):
                both(args, tmp)
                total += 1
            for args in invalid_cases(command, r, tmp):
                both(args, tmp)
                total += 1
        print("diff verifier passed %d cases" % total)


if __name__ == "__main__":
    main()
