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
PORT = ROOT / "executable"
PY = sys.executable
RNG = random.Random(os.environ.get("VERIFIER_SEED") or None)


def run(cmd, cwd, stdin=b""):
    exe, args = cmd[0], cmd[1:]
    if exe == "PORT":
        full = [PY, str(PORT)] + args
    else:
        full = [str(REF)] + args
    return subprocess.run(full, cwd=str(cwd), input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def rand_cell(valid=True):
    if not valid:
        return 'bad"quote' if RNG.random() < 0.5 else "x\ny"
    alphabet = string.ascii_letters + string.digits + " _.-"
    return "".join(RNG.choice(alphabet) for _ in range(RNG.randrange(0, 16)))


def write_csv(path, rows, delimiter=","):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=delimiter, lineterminator="\n")
        w.writerows(rows)


def valid_table():
    cols = RNG.randrange(1, 8)
    rows = RNG.randrange(0, 24)
    header = ["h{}".format(i + 1) for i in range(cols)]
    body = [[rand_cell(True) for _ in range(cols)] for _ in range(rows)]
    return [header] + body


def stable_frequency_table():
    cols = RNG.randrange(1, 6)
    header = ["h{}".format(i + 1) for i in range(cols)]
    body = []
    for r in range(18):
        row = []
        for c in range(cols):
            if r < 9:
                row.append("major{}".format(c))
            elif r < 13:
                row.append("minor{}".format(c))
            elif r < 15:
                row.append("rare{}".format(c))
            else:
                row.append("unique{}_{}".format(c, r))
        body.append(row)
    return [header] + body


def invalid_table():
    cols = RNG.randrange(1, 6)
    rows = [["h{}".format(i + 1) for i in range(cols)]]
    for _ in range(RNG.randrange(1, 5)):
        n = cols + RNG.choice([-1, 1, 2])
        rows.append([rand_cell(True) for _ in range(max(0, n))])
    return rows


def sample_cases(csv_name, cols, valid, freq_stable=False):
    last = str(cols)
    selections = ["1", "1-{}".format(last), "{}-1".format(last), "!1", "h1", "h1,h{}".format(last)]
    if cols == 1:
        selections = ["1", "h1"]
    base = [
        ["headers", csv_name],
        ["headers", "--just-names", csv_name],
        ["count", csv_name],
        ["count", "--no-headers", csv_name],
        ["select", RNG.choice(selections), csv_name],
        ["slice", "-s", str(RNG.randrange(0, 4)), "-l", str(RNG.randrange(0, 6)), csv_name],
        ["search", RNG.choice(["a", "1", "^$", "."]), csv_name],
        ["sort", "-s", RNG.choice(["1", "h1"]), csv_name],
        ["sort", "-N", csv_name],
        ["table", csv_name],
        ["fmt", csv_name],
        ["stats", csv_name],
        ["stats", "--everything", csv_name],
    ]
    if freq_stable:
        base.append(["frequency", "-l", "3", csv_name])
    if not valid:
        base.extend([
            ["select", str(cols + 99), csv_name],
            ["slice", "-s", "-1", csv_name],
            ["search", "[", csv_name],
            ["fmt", "-t", "too-long", csv_name],
        ])
    return base


def main():
    if shutil.which("sh"):
        subprocess.run(["sh", str(ROOT / "compile.sh")], cwd=str(ROOT), check=True)
    elif not PORT.exists():
        raise SystemExit("no sh available and executable is missing")
    failures = []
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        all_cases = []
        for i in range(16):
            rows = stable_frequency_table() if i % 4 == 0 else valid_table()
            p = work / "valid{}.csv".format(i)
            write_csv(p, rows)
            all_cases.extend(sample_cases(p.name, len(rows[0]), True, i % 4 == 0))
        for i in range(4):
            rows = invalid_table()
            p = work / "invalid{}.csv".format(i)
            write_csv(p, rows)
            all_cases.extend(sample_cases(p.name, len(rows[0]), False, False))
        for args in all_cases:
            oracle = run(["REF"] + args, work)
            actual = run(["PORT"] + args, work)
            got = (actual.returncode, actual.stdout, actual.stderr)
            exp = (oracle.returncode, oracle.stdout, oracle.stderr)
            if got != exp:
                failures.append((args, exp, got))
                if len(failures) >= 20:
                    break
    if failures:
        for args, exp, got in failures:
            sys.stderr.write("FAIL {}\nexpected={}\nactual={}\n".format(args, exp, got))
        return 1
    print("differential verifier passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
