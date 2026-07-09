#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "rust-reference"
OFFICIAL = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / "executable"

CASES = [
    ["tests/itest"],
    ["-1", "tests/itest"],
    ["--icons=always", "tests/itest"],
    ["--classify=always", "tests/itest"],
    ["--only-dirs", "tests/itest"],
    ["--only-files", "tests/itest"],
    ["-T", "tests/itest"],
    ["tests/itest/index.svg", "--absolute"],
    ["tests/test_dir", "--long", "--no-user", "--no-time", "--no-filesize", "--no-permissions"],
]


def main():
    failed = []
    for args in CASES:
        oracle = subprocess.run([str(OFFICIAL), *args], cwd=WORK, capture_output=True)
        port = subprocess.run([sys.executable, str(PORT), *args], cwd=WORK, capture_output=True)
        if (oracle.returncode, oracle.stdout, oracle.stderr) != (port.returncode, port.stdout, port.stderr):
            failed.append((args, oracle, port))
    if failed:
        for args, oracle, port in failed[:5]:
            print("FAIL", args)
            print("official", oracle.returncode, repr(oracle.stdout[:300]), repr(oracle.stderr[:200]))
            print("port    ", port.returncode, repr(port.stdout[:300]), repr(port.stderr[:200]))
        return 1
    print("ok: selected original fixture differential cases matched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
