import pathlib
import subprocess
import sys


CASES = [
    "3 + 4",
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "5 mod 2",
    "5.25 mod 2",
    "3 ** 3",
    "10 / 4",
    "10 // 4",
    "1 == 1",
    "true and false",
    "not false",
    '"abc" =~ "b"',
    '"a" in "abc"',
    "[1, 2, 3] | get 1",
    "[1, 2, 3] | length",
    "[1, 2, 3] | first",
    "[3, 1, 2] | sort | to json -r",
    "[a, B, d, C, f] | sort -i | to json --raw",
    "1..5 | math sum",
    "1..5 | where $it > 3 | to json -r",
    "[[a b]; [jim susie] [3 4]] | to json -r",
    "[[a b]; [jim susie] [3 4]] | get a.0",
    "[[a b]; [jim susie] [3 4]].b.1",
    "[[name, age]; [paul, 21]] | columns | get 0",
    "[[name, age]; [paul, 21]] | reject age | to json -r",
    '"hello world" | split row " " | get 1',
    '"hello world" | split column " " | get column1.0',
    '"a-b-c" | str replace "-" "+"',
    '"abc" | str length',
    '"AbC" | str downcase',
    '[a b c] | str join "-"',
    "char nl | str length",
    '{foo: 3, bar: "x"} | to json -r',
    "[[a b]; [1 2]] | to csv",
    "[1,2,3] | to nuon",
    "null | to nuon",
    "pwd",
    "ls | length",
    "path exists REFERENCE_BINARY.txt",
]


def run(args):
    return subprocess.run(args, capture_output=True)


def main():
    ref = pathlib.Path("REFERENCE_BINARY.txt").read_text().strip()
    failures = 0
    for case in CASES:
        expected = run([ref, "-c", case])
        actual = run([sys.executable, "nushell_port.py", "-c", case])
        match = (
            expected.returncode == actual.returncode
            and expected.stdout == actual.stdout
            and expected.stderr == actual.stderr
        )
        print(("OK  " if match else "BAD ") + case)
        if not match:
            failures += 1
            print("  ref ", expected.returncode, repr(expected.stdout.decode(errors="replace")), repr(expected.stderr.decode(errors="replace")[:240]))
            print("  port", actual.returncode, repr(actual.stdout.decode(errors="replace")), repr(actual.stderr.decode(errors="replace")[:240]))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
