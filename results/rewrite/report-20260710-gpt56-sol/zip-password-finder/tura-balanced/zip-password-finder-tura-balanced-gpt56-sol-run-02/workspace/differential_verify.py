"""Differential CLI verifier; uses the reference only as an external test oracle."""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REFERENCE = Path(ROOT / "REFERENCE_BINARY.txt").read_text(encoding="utf-8-sig").strip()
PORT = [sys.executable, str(ROOT / "zip_password_finder_port.py")]
TIME = re.compile(br"^Time elapsed: .+\n", re.M)


def invoke(command, args):
    return subprocess.run([*command, *args], cwd=ROOT, capture_output=True)


def stable_stdout(data):
    return TIME.sub(b"Time elapsed: <duration>\n", data)


CASES = [
    [], ["--help"], ["--version"], ["-i"], ["--wat"],
    ["-i", "missing.zip"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-w", "0"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--minPasswordLen", "0"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--minPasswordLen", "3", "--maxPasswordLen", "2"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-c", "x"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--mask", "?z"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--mask", "?1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-1", "ab"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--mask", "ab", "-p", "rust-reference/test-files/generated-passwords-lowercase.txt"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-s", "A", "-c", "l"],
    ["-irust-reference/test-files/2.test.txt.zip", "--mask", "ab"],
    ["--inputFile=rust-reference/test-files/2.test.txt.zip", "--mask=ab"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-w", "x"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-w", "18446744073709551616"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-c", "l", "-c", "d"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--fileNumber", "9", "--mask", "ab"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--", "extra"],
    ["-i", "rust-reference/README.md", "--mask", "a"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-p", "missing.txt"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--mask", ""],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--mask", "?"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--mask", "?1", "-1", ""],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "--charsetFile", "rust-reference/test-files/file-charset.txt", "--minPasswordLen", "1", "--maxPasswordLen", "2", "-w", "1"],
    ["-i", "rust-reference/test-files/2.test.txt.zip", "-p", "rust-reference/test-files/generated-passwords-lowercase.txt", "-w", "1"],
    ["-i", "rust-reference/test-files/3.test.txt.zip", "-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "3", "-w", "1"],
    ["-i", "rust-reference/test-files/4.test.txt.zip", "--mask", "abcd", "-w", "1"],
    ["-i", "rust-reference/test-files/multi-file-with-dir.zip", "-p", "rust-reference/test-files/generated-passwords-lowercase.txt", "-w", "1"],
]


def main():
    failed = 0
    for args in CASES:
        reference = invoke([REFERENCE], args)
        port = invoke(PORT, args)
        same = (reference.returncode == port.returncode and reference.stderr == port.stderr
                and stable_stdout(reference.stdout) == stable_stdout(port.stdout))
        if not same:
            failed += 1
            print("FAIL", args)
            print(" ref", reference.returncode, repr(reference.stdout), repr(reference.stderr))
            print("port", port.returncode, repr(port.stdout), repr(port.stderr))
    print(f"{len(CASES) - failed}/{len(CASES)} differential cases passed")
    return bool(failed)


if __name__ == "__main__":
    raise SystemExit(main())
