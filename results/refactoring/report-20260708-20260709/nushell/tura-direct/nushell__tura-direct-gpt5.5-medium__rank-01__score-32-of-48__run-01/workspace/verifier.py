#!/usr/bin/env python3
import os
import random
import subprocess
import sys


ROOT = os.path.dirname(os.path.abspath(__file__))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = [sys.executable, os.path.join(ROOT, "executable")]


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=10)
    return p.returncode, p.stdout, p.stderr


def comparable(result):
    code, out, err = result
    if code != 0:
        first = err.splitlines()[0] if err else ""
        return code, out, first
    return result


def gen_valid(rng):
    nums = [rng.randint(-50, 50) for _ in range(3)]
    s = rng.choice(["", "abc", "A b C", "1,2,3", "hello"])
    table = f"[[a b]; [{nums[0]} {nums[1]}] [{nums[1]} {nums[2]}]]"
    choices = [
        f"{nums[0]} + {nums[1]} * {nums[2]}",
        f"[{nums[0]} {nums[1]} {nums[2]}] | math sum",
        f"[{nums[0]} {nums[1]} {nums[2]}] | length",
        f"\"{s}\" | str length",
        f"\"{s}\" | str upcase",
        f"{{a: {nums[0]}, b: \"{s}\"}} | to json",
        f"{table} | get a | math sum",
        f"{table} | where a > {min(nums)} | to json",
        f"{table} | select a | to csv",
    ]
    return rng.choice(choices)


def gen_invalid(rng):
    return rng.choice(["1 +", "[1 2", "{a: 1", "unknowncmd", "[1 2] | get 9", '"abc" | str bad'])


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED"))
    samples = [gen_valid(rng) for _ in range(32)] + [gen_invalid(rng) for _ in range(8)]
    failed = 0
    for s in samples:
        ref = run([REF, "-n", "--no-std-lib", "--error-style", "plain", "-c", s])
        got = run(PORT + ["-n", "--no-std-lib", "--error-style", "plain", "-c", s])
        if comparable(ref) != comparable(got):
            failed += 1
            print("FAIL", s)
            print("REF", ref)
            print("GOT", got)
    if failed:
        return 1
    print(f"ok {len(samples)} generated samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
