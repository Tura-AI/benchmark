#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / "executable"
RUST = ROOT / "rust-reference"


CASES = [
    ["--color=never", "--icons=never", "tests/itest"],
    ["--color=never", "--icons=never", "tests/itest", "-T"],
    ["--color=never", "--icons=never", "tests/itest", "--long"],
    ["--color=never", "--icons=never", "tests/itest", "--long", "--no-user", "--no-time", "--no-filesize"],
    ["--color=never", "--icons=never", "tests/itest", "--only-files"],
    ["--color=never", "--icons=never", "tests/itest", "--only-dirs"],
    ["--color=never", "--icons=never", "tests/itest", "--sort=type"],
    ["--color=never", "--icons=never", "tests/itest", "--group-directories-first"],
]


def run_ref(args):
    return subprocess.run([str(REF), *args], cwd=RUST, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def run_port(args):
    return subprocess.run([sys.executable, str(PORT), *args], cwd=RUST, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def norm(proc):
    return proc.returncode, proc.stdout.replace(b"\r\n", b"\n"), proc.stderr.replace(b"\r\n", b"\n")


def main():
    for args in CASES:
        ref = norm(run_ref(args))
        got = norm(run_port(args))
        if ref != got:
            print(f"args={args!r}")
            print(f"ref={ref!r}")
            print(f"got={got!r}")
            return 1
    print(f"ok original-fixtures={len(CASES)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
