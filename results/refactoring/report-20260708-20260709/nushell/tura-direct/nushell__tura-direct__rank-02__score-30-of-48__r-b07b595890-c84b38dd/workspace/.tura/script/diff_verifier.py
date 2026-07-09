#!/usr/bin/env python3
import json
import os
import random
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text(encoding="utf-8").strip())
PORT = ROOT / "executable"


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return {"code": p.returncode, "out": p.stdout, "err": p.stderr}


def valid_expr(rng):
    nums = [rng.randint(-50, 50) for _ in range(4)]
    strings = ["", "abc", "A b", "x,y", "line\\nnext", "Rust"]
    choices = [
        f"{nums[0]} + {nums[1]} * {nums[2]}",
        f"[{nums[0]} {nums[1]} {nums[2]}] | math sum",
        f"1..{abs(nums[0]) % 9 + 1} | math sum",
        f"'{rng.choice(strings)}' | str length",
        f"'{rng.choice(strings)}' | str upcase",
        f"[[a,b]; [{nums[0]},{nums[1]}], [{nums[2]},{nums[3]}]] | to json --raw",
        f"{{a: {nums[0]}, b: [{nums[1]} {nums[2]}]}} | to json --raw",
        "'{\"name\": \"Fred\"}' | from json | get name",
        "'a,b\n1,2\n3,4' | from csv | to json --raw",
        f"[{nums[0]}, {nums[1]}, {nums[2]}] | length",
        f"[{nums[0]}, {nums[1]}, {nums[2]}] | get 1",
        f"'{rng.choice(strings)}' in 'abcRust'",
    ]
    return rng.choice(choices)


def invalid_expr(rng):
    return rng.choice(["3 + ", "42 in 'abc'", "[1 2] | get 9", "[] | math sum"])


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    samples = [valid_expr(rng) for _ in range(16)] + [invalid_expr(rng) for _ in range(4)]
    failures = []
    for s in samples:
        oracle = run([str(REF), "-c", s])
        actual = run([sys.executable, str(PORT), "-c", s])
        if oracle != actual:
            failures.append({"script": s, "oracle": oracle, "actual": actual})
    if failures:
        print(json.dumps(failures, indent=2, ensure_ascii=False))
        return 1
    print(f"ok {len(samples)} samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
