#!/usr/bin/env python3
"""Differential verifier for the benchmarked Nushell port.

It generates fresh valid and invalid `nu -c` samples for each behavior group,
runs the official reference binary live, runs this Python port with the same
argv, and compares exit status, stdout, and stderr exactly.
"""

from __future__ import annotations

import os
import random
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text(encoding="utf-8").strip())
PORT = ROOT / "executable"


def run(cmd: str, exe: Path) -> tuple[int, str, str]:
    if exe == PORT:
        argv = [sys.executable, str(exe), "-n", "-c", cmd]
    else:
        argv = [str(exe), "-n", "-c", cmd]
    p = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, timeout=10)
    return p.returncode, p.stdout, p.stderr


def q(s: str) -> str:
    return repr(s)


def samples(seed: int) -> list[str]:
    rng = random.Random(seed)
    out: list[str] = []
    for _ in range(16):
        a, b, c = [rng.randint(-50, 80) for _ in range(3)]
        out += [f"{a} + {b} * {c}", f"({a} + {b}) mod {abs(c) + 1}"]
    for _ in range(16):
        vals = [rng.randint(0, 20) for _ in range(rng.randint(2, 7))]
        out += ["[" + ", ".join(map(str, vals)) + "] | math sum", "[" + ", ".join(map(str, vals)) + "] | length"]
    alphabet = ["alpha", "Beta", "nu shell", "x,y", "  trim  ", "line1\\nline2"]
    for _ in range(16):
        s = rng.choice(alphabet)
        out += [f"{q(s)} | str upcase", f"{q(s)} | str length", f"{q(s)} | str contains {q(s[:1])}"]
    for _ in range(16):
        a, b = rng.randint(1, 20), rng.randint(21, 50)
        out += [f"{a}..{b} | where $it > {b - 3} | math sum"]
    for _ in range(16):
        name = rng.choice(["ann", "bob", "cyd"])
        age = rng.randint(1, 99)
        out += [f"{{name: {q(name)}, age: {age}}} | to json -r", f"[[name age]; [{name} {age}]] | get age.0"]
    for _ in range(16):
        a, b = rng.randint(0, 9), rng.randint(10, 19)
        out += [f"'{{\"a\":{a},\"b\":{b}}}' | from json | get b"]
    invalid = ["3 + ", "'abc", "[1, 2", "42 in 'abc'"] * 6
    out.extend(invalid)
    rng.shuffle(out)
    return out


def main() -> int:
    seed = int(os.environ.get("VERIFIER_SEED", "0") or "0") or random.randrange(1, 1_000_000)
    failures = []
    for case in samples(seed):
        expected = run(case, REF)
        actual = run(case, PORT)
        if expected != actual:
            failures.append((case, expected, actual))
            if len(failures) >= 10:
                break
    if failures:
        print(f"seed={seed} failures={len(failures)}")
        for case, exp, act in failures:
            print("CASE", case)
            print("REF ", exp)
            print("PORT", act)
        return 1
    print(f"seed={seed} ok cases={len(samples(seed))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
