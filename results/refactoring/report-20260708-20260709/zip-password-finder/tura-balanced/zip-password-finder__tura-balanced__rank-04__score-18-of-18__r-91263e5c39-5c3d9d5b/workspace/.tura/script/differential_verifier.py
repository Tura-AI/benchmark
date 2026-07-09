import os
import random
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]
FIXTURES = ROOT / "rust-reference" / "test-files"


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=20)


def normalize(out):
    return re.sub(r"Time elapsed: .+", "Time elapsed: <elapsed>", out)


def compare(argv):
    oracle = run([str(REF), *argv])
    actual = run([*PORT, *argv])
    left = (oracle.returncode, normalize(oracle.stdout), oracle.stderr)
    right = (actual.returncode, normalize(actual.stdout), actual.stderr)
    if left != right:
        print("ARGV", argv)
        print("ORACLE", left)
        print("ACTUAL", right)
        raise AssertionError("differential mismatch")


def valid_samples(rng):
    zips = ["2.test.txt.zip", "3.test.txt.zip", "multi-file-with-dir.zip"]
    for i in range(16):
        zip_name = rng.choice(zips)
        max_len = {"2.test.txt.zip": 2, "3.test.txt.zip": 3}.get(zip_name, 2)
        mode = i % 4
        base = ["-i", str(FIXTURES / zip_name), "--workers", "1"]
        if mode == 0:
            yield base + ["-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", str(max_len)]
        elif mode == 1:
            yield base + ["-p", str(FIXTURES / "generated-passwords-lowercase.txt")]
        elif mode == 2:
            yield base + ["--mask", "?l" * max_len]
        else:
            yield base + ["--mask", "?1" * max_len, "-1", "abcd"]
    yield ["-i", str(FIXTURES / "4.test.txt.zip"), "--workers", "1", "--mask", "abcd"]
    yield ["-i", str(FIXTURES / "2.test.txt.zip"), "--workers", "1", "-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "1"]


def invalid_samples(rng):
    good_zip = str(FIXTURES / "2.test.txt.zip")
    candidates = [
        [],
        ["-i", "missing.zip"],
        ["-i", good_zip, "--workers", "0"],
        ["-i", good_zip, "--minPasswordLen", "2", "--maxPasswordLen", "1"],
        ["-i", good_zip, "--mask", "?1?d"],
        ["-i", good_zip, "--mask", "?z"],
        ["-i", good_zip, "-p", "missing.txt"],
        ["-i", good_zip, "-c", "x", "--minPasswordLen", "1", "--maxPasswordLen", "1"],
    ]
    rng.shuffle(candidates)
    yield from candidates[:4]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    for argv in valid_samples(rng):
        compare(argv)
    for argv in invalid_samples(rng):
        compare(argv)
    print("differential verifier passed")


if __name__ == "__main__":
    main()
