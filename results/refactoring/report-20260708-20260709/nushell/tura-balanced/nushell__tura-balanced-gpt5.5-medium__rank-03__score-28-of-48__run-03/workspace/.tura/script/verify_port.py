#!/usr/bin/env python3
import os
import random
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = os.path.join(ROOT, "executable.cmd" if os.name == "nt" else "executable")


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=10)
    return p.returncode, p.stdout, p.stderr


def same(expr, oracle, actual):
    invalid = expr in {"3 + ", "[1 2", "{a: 1", "foo_not_found", "[1 2] | get 10", "[] | math sum"}
    if invalid:
        return oracle[0] == actual[0] and (oracle[0] != 0)
    return oracle == actual


def q(s):
    return repr(s)


def samples(seed):
    rng = random.Random(seed)
    ops = ["+", "-", "*", "mod", "==", "!=", "<", "<=", ">", ">="]
    for _ in range(16):
        a, b = rng.randint(-100, 100), rng.randint(1, 100)
        yield f"{a} {rng.choice(ops)} {b}"
    for _ in range(16):
        xs = [rng.randint(-20, 20) for _ in range(rng.randint(0, 8))]
        yield "[" + " ".join(map(str, xs)) + "] | length"
        if xs:
            yield "[" + " ".join(map(str, xs)) + "] | math sum"
    for _ in range(16):
        s = "".join(rng.choice("abc XYZ,._-") for _ in range(rng.randint(0, 24)))
        yield f"{q(s)} | str length"
        yield f"{q(s)} | str upcase"
        yield f"{q(s)} | split row {q(' ')} | length"
    for _ in range(16):
        a, b = rng.randint(0, 9), rng.randint(0, 9)
        yield f"{{a: {a}, b: {b}}} | to json -r"
        yield f"[[name,age]; [bob,{a}] [ann,{b}]] | get age.1"
        yield f"[[name,age]; [bob,{a}] [ann,{b}]] | to csv"
    invalid = ["3 + ", "[1 2", "{a: 1", "foo_not_found", "[1 2] | get 10", "[] | math sum"]
    for s in invalid:
        yield s


def main():
    seed = os.environ.get("VERIFIER_SEED", str(random.randrange(1 << 30)))
    failures = []
    count = 0
    for expr in samples(seed):
        count += 1
        oracle = run([REF, "-c", expr])
        actual = run([PORT, "-c", expr])
        if not same(expr, oracle, actual):
            failures.append((expr, oracle, actual))
            if len(failures) >= 10:
                break
    if failures:
        print(f"seed={seed} count={count} failures={len(failures)}")
        for expr, oracle, actual in failures:
            print("EXPR", expr)
            print("REF", oracle)
            print("PORT", actual)
        return 1
    print(f"ok seed={seed} cases={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
