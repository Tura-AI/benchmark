#!/usr/bin/env python3
import os
import random
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def read_reference():
    with open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), "r", encoding="utf-8") as f:
        return f.read().strip()


def run(cmd, expr):
    p = subprocess.run([cmd, "-n", "-c", expr], cwd=ROOT, text=True, capture_output=True)
    return p.returncode, p.stdout, p.stderr


def compatible(result):
    code, out, err = result
    if code != 0:
        return code, "", "ERR"
    return code, out, ""


def valid_expr(rng):
    nums = [rng.randint(-50, 50) for _ in range(3)]
    strings = ["", "abc", "a,b", " spaced ", "Quote ' x", "line\\ntext"]
    tables = [
        "[[name age]; [bob 10] [ann 20]] | get name | str join '-'",
        "[[name age]; [bob 10] [ann 20]] | where age >= 20 | length",
        "[[name age]; [bob 10] [ann 20]] | to json -r",
    ]
    choices = [
        f"{nums[0]} + {nums[1]} * {nums[2]}",
        f"({nums[0]} + {nums[1]}) == {nums[2]}",
        f"[{nums[0]} {nums[1]} {nums[2]}] | math sum",
        f"[{nums[0]} {nums[1]} {nums[2]}] | sort | to json -r",
        f"'{rng.choice(strings)}' | str length",
        f"'{rng.choice(strings)}' | str trim | str upcase",
        f"{{a: {nums[0]}, b: test}} | get a",
        rng.choice(tables),
        "'{\"a\":1,\"b\":[2,3]}' | from json | get b | length",
    ]
    return rng.choice(choices)


def invalid_expr(rng):
    choices = ["1 +", "[1 2", "{a: 1", "1 / 0", "[1 2] | get 9", "{a: 1} | get z", "open __missing_file__"]
    return rng.choice(choices)


def main():
    ref = read_reference()
    exe = os.path.join(ROOT, "executable")
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    cases = [valid_expr(rng) for _ in range(16)] + [invalid_expr(rng) for _ in range(4)]
    failures = []
    for expr in cases:
        oracle = run(ref, expr)
        actual = subprocess.run([sys.executable, exe, "-n", "-c", expr], cwd=ROOT, text=True, capture_output=True)
        got = (actual.returncode, actual.stdout, actual.stderr)
        if compatible(oracle) != compatible(got):
            failures.append((expr, oracle, got))
    if failures:
        for expr, oracle, got in failures[:8]:
            print("CASE", expr)
            print("ORACLE", repr(oracle))
            print("GOT   ", repr(got))
        return 1
    print(f"ok {len(cases)} generated cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
