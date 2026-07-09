#!/usr/bin/env python3
import csv
import os
import random
import shutil
import string
import subprocess
import sys
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = os.path.join(ROOT, "executable")


def run(cmd, cwd, stdin=b""):
    exe = [sys.executable, PORT] if cmd[0] == "PORT" else [REF]
    return subprocess.run(exe + cmd[1:], cwd=cwd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def write_csv(path, rows, delim=","):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=delim, lineterminator="\n")
        w.writerows(rows)


def rand_field(rng):
    choices = ["", "a", "b", "1", "2", "10", "1.5", " space ", "x,y", 'q"q']
    if rng.random() < 0.5:
        return rng.choice(choices)
    return "".join(rng.choice(string.ascii_letters + string.digits + " _-") for _ in range(rng.randrange(0, 10)))


def valid_rows(rng):
    cols = rng.randrange(1, 5)
    rows = [["h%d" % (i + 1) for i in range(cols)]]
    for _ in range(rng.randrange(0, 12)):
        rows.append([rand_field(rng) for _ in range(cols)])
    return rows


def check_case(tmp, argv, rows=None, invalid=False):
    cwd_ref = os.path.join(tmp, "ref")
    cwd_port = os.path.join(tmp, "port")
    os.makedirs(cwd_ref, exist_ok=True)
    os.makedirs(cwd_port, exist_ok=True)
    if rows is not None:
        write_csv(os.path.join(cwd_ref, "in.csv"), rows)
        write_csv(os.path.join(cwd_port, "in.csv"), rows)
    ref = run(["REF"] + argv, cwd_ref)
    got = run(["PORT"] + argv, cwd_port)
    if (ref.returncode, ref.stdout, ref.stderr) != (got.returncode, got.stdout, got.stderr):
        sys.stderr.write("Mismatch argv=%r invalid=%r\n" % (argv, invalid))
        sys.stderr.write("rows=%r\n" % (rows,))
        sys.stderr.write("ref status=%s stdout=%r stderr=%r\n" % (ref.returncode, ref.stdout, ref.stderr))
        sys.stderr.write("got status=%s stdout=%r stderr=%r\n" % (got.returncode, got.stdout, got.stderr))
        raise SystemExit(1)


def samples_for(command, rng):
    for _ in range(16):
        rows = valid_rows(rng)
        if command == "headers":
            yield ["headers", "in.csv"], rows, False
        elif command == "count":
            yield ["count", rng.choice(["--no-headers", ""]), "in.csv"], rows, False
        elif command == "select":
            cols = len(rows[0])
            choice = rng.choice(["1", "1-", "-1", str(cols), "!1"])
            yield (["select", "--", choice, "in.csv"] if choice.startswith("-") else ["select", choice, "in.csv"]), rows, False
        elif command == "slice":
            yield ["slice", "--start", str(rng.randrange(0, 3)), "--len", str(rng.randrange(0, 5)), "in.csv"], rows, False
        elif command == "search":
            yield ["search", rng.choice(["a", "^1", " ", "z"]), "in.csv"], rows, False
        elif command == "sort":
            yield ["sort", rng.choice(["-N", "-R", "--no-headers"]), "in.csv"], rows, False
        elif command == "table":
            yield ["table", "in.csv"], rows, False
        elif command == "fmt":
            opt = rng.choice(["--quote-always", "--crlf", "--out-delimiter"])
            if opt == "--out-delimiter":
                yield ["fmt", opt, rng.choice([";", r"\t"]), "in.csv"], rows, False
            else:
                yield ["fmt", opt, "in.csv"], rows, False
        elif command == "stats":
            yield ["stats", rng.choice(["--median", "--mode", "--cardinality", "--everything"]), "in.csv"], rows, False
        elif command == "frequency":
            cols = len(rows[0])
            pattern = [0, 0, 0, 0, 1, 1, 2]
            rows = [rows[0]] + [["v%d_%d" % (c, k) for c in range(cols)] for k in pattern]
            yield ["frequency", "--limit", str(rng.randrange(0, 4)), "in.csv"], rows, False
    for _ in range(4):
        rows = valid_rows(rng)
        if command in ("select", "search", "sort", "stats", "frequency"):
            base = {"select": ["select", "999", "in.csv"], "search": ["search", "[", "in.csv"], "sort": ["sort", "--select", "999", "in.csv"], "stats": ["stats", "--select", "999", "in.csv"], "frequency": ["frequency", "--select", "999", "in.csv"]}[command]
        elif command == "slice":
            base = ["slice", "--start", "5", "--end", "1", "in.csv"]
        else:
            base = [command, "missing.csv"]
        yield base, rows, True


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    commands = ["headers", "count", "select", "slice", "search", "sort", "table", "fmt", "stats", "frequency"]
    with tempfile.TemporaryDirectory() as tmp:
        for command in commands:
            for argv, rows, invalid in samples_for(command, rng):
                argv = [x for x in argv if x]
                check_case(tmp, argv, rows, invalid)
                shutil.rmtree(os.path.join(tmp, "ref"), ignore_errors=True)
                shutil.rmtree(os.path.join(tmp, "port"), ignore_errors=True)
    print("differential verifier passed")


if __name__ == "__main__":
    main()
