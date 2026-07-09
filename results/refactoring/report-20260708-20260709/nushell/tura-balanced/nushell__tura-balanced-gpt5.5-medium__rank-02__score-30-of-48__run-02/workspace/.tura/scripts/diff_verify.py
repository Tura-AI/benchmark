#!/usr/bin/env python3
import json
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
if not PORT.exists():
    PORT = ROOT / "nushell_port.py"


def run(exe, script, cwd=None, stdin=None):
    if exe.name == "executable" or exe.suffix == ".py":
        argv = [sys.executable, str(exe), "--no-config-file", "--no-std-lib", "-c", script]
    else:
        argv = [str(exe), "--no-config-file", "--no-std-lib", "-c", script]
    p = subprocess.run(argv, input=stdin, text=True, capture_output=True, cwd=cwd or ROOT, timeout=8)
    return p.returncode, p.stdout, p.stderr


def q(s):
    return "'" + s.replace("'", "\\'") + "'"


def rand_word(rng, n=None):
    n = n or rng.randint(0, 16)
    chars = string.ascii_letters + string.digits + " _-."
    return "".join(rng.choice(chars) for _ in range(n))


def valid_math(rng, i):
    a, b, c = rng.randint(-50, 50), rng.randint(1, 20), rng.randint(1, 10)
    return rng.choice([
        f"{a} + {b} * {c}",
        f"({a} + {b}) * {c}",
        f"{a} mod {b}",
        f"{b} ** 2",
        f"[{a} {b} {c}] | math sum",
        f"[{a} {b} {c}] | math min",
        f"1..{c} | math sum",
    ])


def invalid_math(rng, i):
    return rng.choice(["3 +", "9 bit-shl -2", "[a b] | math sum", "1 / 'x'"])


def valid_strings(rng, i):
    s = rand_word(rng)
    needle = s[:1] if s else "a"
    return rng.choice([
        f"{q(s)} | str length",
        f"{q('  ' + s + '  ')} | str trim",
        f"{q(s)} | str contains {q(needle)}",
        f"{q(s)} | str replace {q(needle)} {q('X')}",
        f"[{q('a')} {q('b')} {q('c')}] | str join {q(',')}",
    ])


def invalid_strings(rng, i):
    return rng.choice(["'abc", "42 in 'abc'", "'abc' | str substring 'x'", "'abc' | str replace"])


def valid_json_csv(rng, i):
    rows = [{"name": rand_word(rng, rng.randint(1, 8)), "age": rng.randint(0, 99)} for _ in range(rng.randint(1, 5))]
    js = json.dumps(rows, separators=(",", ":"))
    csv_text = "name,age\n" + "\n".join(f"{r['name']},{r['age']}" for r in rows)
    return rng.choice([
        f"{q(js)} | from json | to json --raw",
        f"{q(json.dumps(rows[0], separators=(',', ':')))} | from json | get age",
        f"{q(csv_text)} | from csv | to json --raw",
        f"{q(csv_text)} | from csv | get name | str join {q(',')}",
    ])


def invalid_json_csv(rng, i):
    return rng.choice([f"{q('{bad json}')} | from json", f"{q('a,b\n1')} | from csv | get missing", "from json", f"{q('a,b\n1,2')} | from csv | get 9"])


def valid_tables(rng, i):
    a, b = rng.randint(0, 50), rng.randint(51, 100)
    return rng.choice([
        f"[[name age]; [bob {a}] [ann {b}]] | where age > {a} | get name.0",
        f"[[name age]; [bob {a}] [ann {b}]] | select name | to json --raw",
        f"[[name age]; [bob {a}] [ann {b}]] | get age | math sum",
        f"[1 2 3 {a}] | each {{ |x| $x + 1 }} | to json --raw",
    ])


def invalid_tables(rng, i):
    return rng.choice(["[[a]; [1]] | get b", "[1 2] | where age > 1", "[1 2] | get 9", "[1 2] | each 3"])


def valid_files(rng, i, cwd):
    (cwd / "data.json").write_text(json.dumps({"x": rng.randint(1, 9)}), encoding="utf-8")
    (cwd / "data.csv").write_text("a,b\n1,2\n3,4\n", encoding="utf-8")
    (cwd / "note.txt").write_text("hello\nworld\n", encoding="utf-8")
    return rng.choice([
        "open data.json | get x",
        "open data.csv | get a | str join ','",
        "open note.txt | lines | length",
        "ls | get name | length",
    ])


def invalid_files(rng, i, cwd):
    return rng.choice(["open missing.json", "open data.json | get missing", "glob '['", "save"])


GROUPS = [
    ("math", valid_math, invalid_math),
    ("strings", valid_strings, invalid_strings),
    ("json_csv", valid_json_csv, invalid_json_csv),
    ("tables", valid_tables, invalid_tables),
]


def comparable(kind, oracle, actual):
    if kind == "invalid" and os.environ.get("NU_PORT_INVALID_SEMANTIC") == "1":
        return oracle[0] != 0 and actual[0] != 0 and oracle[1] == actual[1] == "" and bool(oracle[2]) and bool(actual[2])
    return oracle == actual


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    failures = []
    with tempfile.TemporaryDirectory(prefix="nu-port-verify-") as td:
        cwd = Path(td)
        groups = list(GROUPS) + [("filesystem", lambda r, i: valid_files(r, i, cwd), lambda r, i: invalid_files(r, i, cwd))]
        for name, valid, invalid in groups:
            cases = [("valid", valid(rng, i)) for i in range(16)] + [("invalid", invalid(rng, i)) for i in range(4)]
            for kind, script in cases:
                oracle = run(REF, script, cwd)
                actual = run(PORT, script, cwd)
                if not comparable(kind, oracle, actual):
                    failures.append((name, kind, script, oracle, actual))
                    print(f"FAIL {name} {kind}: {script}")
                    print(f"  ref={oracle!r}")
                    print(f"  got={actual!r}")
                    if len(failures) >= 20:
                        return 1
        if failures:
            return 1
        print("ok: generated differential verifier passed")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
