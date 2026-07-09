#!/usr/bin/env python3
import os
import subprocess


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = os.path.join(ROOT, "executable.cmd" if os.name == "nt" else "executable")

CASES = [
    "3 + 4",
    "3 + 4 + 9",
    "5 mod 2",
    "5.25 mod 2",
    "16 bit-shr 1",
    "5 bit-shl 1",
    "true and false",
    "true or false",
    "false xor true",
    "3 ** 3",
    "'testme' =~ 'test'",
    "'d' not-in 'abc'",
    "'z' in 'abc'",
    "1 < 3",
    "3 <= 3",
    "3 > 1",
    "[[lang, gems]; [nu, 100]] | reject gems | to json",
    "[[lang, gems, grade]; [nu, 100, a]] | reject gems | to json -r",
    "[[lang, gems, grade]; [nu, 100, a]] | drop column 2 | to json",
    "{'a': 'b'} | get a",
    "{'b': 'c'}.b",
    "1..10 | where $it > 8 | math sum",
    "[1, 2, 3].1",
    '"hello world" | split row " " | get 1',
    '"hello world" | split column " " | get "column1".0',
    "([1, 2, 3] | wrap foo).foo.1",
    "[[name,age,grade]; [bill,20,a] [a,b,c]] | columns | length",
    "[[name,age,grade]; [bill,20,a] [a,b,c]] | length",
    '''('{"name": "Fred"}' | from json).name''',
    "[[a b]; [jim susie] [3 4]] | to json -r",
]


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=10)
    return p.returncode, p.stdout, p.stderr


def main():
    failures = []
    for expr in CASES:
        ref = run([REF, "-c", expr])
        port = run([PORT, "-c", expr])
        if ref != port:
            failures.append((expr, ref, port))
    if failures:
        print(f"failures={len(failures)}")
        for expr, ref, port in failures:
            print("EXPR", expr)
            print("REF", ref)
            print("PORT", port)
        return 1
    print(f"ok cases={len(CASES)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
