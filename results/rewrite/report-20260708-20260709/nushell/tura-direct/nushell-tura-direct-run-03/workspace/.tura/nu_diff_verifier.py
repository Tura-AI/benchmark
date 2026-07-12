#!/usr/bin/env python3
import json
import os
import random
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = os.path.join(ROOT, "executable.cmd")


def run(exe, code):
    p = subprocess.run([exe, "-c", code], cwd=ROOT, text=True, capture_output=True)
    return p.returncode, p.stdout, p.stderr


def compatible(want, got):
    if want[0] == 0:
        return want == got
    return got[0] != 0 and got[1] == want[1] and bool(got[2]) == bool(want[2])


def scalar(rng):
    choices = ["null", "true", "false", str(rng.randint(-50, 50)), repr(rng.choice(["", "a b", "x,y", "quote'", "line`nnext"])).replace('"', '\\"')]
    return rng.choice(choices)


def samples(rng):
    for _ in range(16):
        a, b = rng.randint(-100, 100), rng.randint(1, 20)
        yield f"{a} + {b} * 2"
        yield f"[{', '.join(str(rng.randint(0, 9)) for _ in range(rng.randint(0, 6)))}] | length"
        yield f"{{a: {a}, b: '{rng.choice(['x','y','z'])}'}} | to json -r"
        yield f"[[name, age]; [bob, {abs(a)%80}] [ann, {b}]] | sort-by age | to json -r"
        yield f"'hello {rng.choice(['world','nu','there'])}' | str upcase"
    for _ in range(4):
        yield rng.choice(["[1 2", "{a: 1", "1 +", "[[a,a]; [1,2]]", "[1] | get 9"])


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED"))
    total = 0
    for code in samples(rng):
        total += 1
        want = run(REF, code)
        got = run(PORT, code)
        if not compatible(want, got):
            print(json.dumps({"code": code, "want": want, "got": got}, ensure_ascii=False, indent=2))
            return 1
    print(f"ok {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
