import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


CASES = [
    ("integer", "1 + 2 * 3", None),
    ("float", "10 / 4", None),
    ("bool", "3 > 2", None),
    ("nothing", "null", None),
    ("string-single", "'hello world'", None),
    ("string-interpolation", "$'sum=(2 + 3)'", None),
    ("list", "[1 2 3]", None),
    ("record", "{name: alice, age: 30}", None),
    ("table", "[[name age]; [alice 30] [bob 25]]", None),
    ("range", "1..5 | each {|x| $x * 2 }", None),
    ("where", "[[name age]; [alice 30] [bob 25]] | where age > 25 | get name.0", None),
    ("select", "[[a b]; [1 2] [3 4]] | select b | to json -r", None),
    ("get", "{a: {b: [10 20]}} | get a.b.1", None),
    ("length", "[a b c] | length", None),
    ("first", "[3 1 2] | first", None),
    ("last", "[3 1 2] | last", None),
    ("sort", "[3 1 2] | sort | str join ','", None),
    ("describe", "{a: 1} | describe", None),
    ("json-in", "'{\"name\":\"Fred\",\"n\":2}' | from json | get name", None),
    ("json-pretty", "{a: 1, b: [true null x]} | to json", None),
    ("json-raw", "{a: 1, b: [true null x]} | to json -r", None),
    ("json-lines", "'{\"a\":1}\n{\"a\":2}' | from json -o | get a | math sum", None),
    ("csv-in", "'name,age\nalice,30\nbob,25' | from csv | get age.1", None),
    ("csv-out", "[[name age]; [alice 30] [bob 25]] | to csv", None),
    ("str-upcase", "'Hello!' | str upcase", None),
    ("str-downcase", "'Hello!' | str downcase", None),
    ("str-trim", "'  hello  ' | str trim", None),
    ("str-replace", "'abc abc' | str replace -a 'a' 'x'", None),
    ("str-contains", "'abcdef' | str contains 'cd'", None),
    ("str-starts", "'abcdef' | str starts-with 'ab'", None),
    ("str-ends", "'abcdef' | str ends-with 'ef'", None),
    ("str-split", "'a,b,c' | split row ',' | get 1", None),
    ("str-length", "'héllo' | str length", None),
    ("math-sum", "[1 2 3.5] | math sum", None),
    ("math-avg", "[1 2 3] | math avg", None),
    ("math-min", "[9 2 5] | math min", None),
    ("math-max", "[9 2 5] | math max", None),
    ("math-round", "3.14159 | math round --precision 2", None),
    ("math-sqrt", "9 | math sqrt", None),
    ("stdin", "$in | str trim | str upcase", " hello \n"),
    ("variable", "let x = 4; $x * 3", None),
    ("if", "if 2 > 1 { 'yes' } else { 'no' }", None),
    ("open-text", "open sample.txt | str trim", None),
    ("open-json", "open sample.json | get value", None),
    ("ls", "ls | sort-by name | select name type | to json -r", None),
    ("error-parse", "1 +", None),
    ("error-command", "definitely_missing_command", None),
    ("error-type", "1 | str upcase", None),
]


def run(command, expression, stdin, cwd):
    invocation = [command]
    if os.name == "nt" and Path(command).name == "executable":
        invocation = [sys.executable, command]
    completed = subprocess.run(
        invocation + ["-n", "--no-std-lib", "-c", expression],
        input=None if stdin is None else stdin.encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env={**os.environ, "NO_COLOR": "1"},
    )
    return completed.returncode, completed.stdout, completed.stderr


def encoded(data):
    return base64.b64encode(data).decode("ascii")


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: differential.py REFERENCE [CANDIDATE]")
    reference = os.path.abspath(sys.argv[1])
    candidate = os.path.abspath(sys.argv[2]) if len(sys.argv) == 3 else None
    failures = 0
    with tempfile.TemporaryDirectory(prefix="nu-port-") as cwd:
        with open(os.path.join(cwd, "sample.txt"), "w", encoding="utf-8", newline="") as handle:
            handle.write(" sample text \n")
        with open(os.path.join(cwd, "sample.json"), "w", encoding="utf-8", newline="") as handle:
            json.dump({"value": 42}, handle)
        for name, expression, stdin in CASES:
            expected = run(reference, expression, stdin, cwd)
            if candidate is None:
                print(json.dumps({"name": name, "code": expected[0], "out": encoded(expected[1]), "err": encoded(expected[2])}))
                continue
            actual = run(candidate, expression, stdin, cwd)
            if actual != expected:
                failures += 1
                print(json.dumps({
                    "name": name,
                    "expression": expression,
                    "expected": [expected[0], encoded(expected[1]), encoded(expected[2])],
                    "actual": [actual[0], encoded(actual[1]), encoded(actual[2])],
                }))
    if candidate is not None:
        print(f"{len(CASES) - failures}/{len(CASES)} differential cases passed")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
