import os
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]
FIXTURES = ROOT / "rust-reference" / "test-files"


def run(cmd, cwd=ROOT):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60)
    return proc.returncode, normalize(proc.stdout), normalize(proc.stderr)


def normalize(text):
    text = re.sub(r"Time elapsed: [^\n]+", "Time elapsed: <elapsed>", text)
    text = text.replace("zip-password-finder.exe", "executable")
    return text


def valid_samples(rng):
    zips = ["2.test.txt.zip", "3.test.txt.zip", "4.test.txt.zip", "multi-file-with-dir.zip"]
    for i in range(16):
        archive = FIXTURES / rng.choice(zips)
        workers = str(rng.randint(1, 3))
        mode = i % 4
        if mode == 0:
            max_len = str(rng.randint(1, 4))
            yield ["-i", str(archive), "-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", max_len, "--workers", workers]
        elif mode == 1:
            yield ["-i", str(archive), "-p", str(FIXTURES / "generated-passwords-lowercase.txt"), "--workers", workers]
        elif mode == 2:
            mask = rng.choice(["?l?l", "?l?l?l", "a?l", "?d?d"])
            yield ["-i", str(archive), "--mask", mask, "--workers", workers]
        else:
            yield ["-i", str(archive), "--charsetFile", str(FIXTURES / "file-charset.txt"), "--minPasswordLen", "1", "--maxPasswordLen", "2", "--workers", workers]


def invalid_samples(rng):
    archive = str(FIXTURES / "2.test.txt.zip")
    yield []
    yield ["-i", "missing.zip"]
    yield ["-i", archive, "--workers", "0"]
    yield ["-i", archive, "--minPasswordLen", "0"]
    yield ["-i", archive, "--maxPasswordLen", "0"]
    yield ["-i", archive, "--minPasswordLen", "3", "--maxPasswordLen", "2"]
    yield ["-i", archive, "--charset", "x", "--maxPasswordLen", "1"]
    yield ["-i", archive, "--mask", "?1?d"]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or os.urandom(16))
    cases = list(valid_samples(rng)) + list(invalid_samples(rng))
    failures = []
    for args in cases:
        oracle = run([str(REFERENCE), *args])
        actual = run([*PORT, *args])
        if oracle != actual:
            failures.append((args, oracle, actual))
            break
    if failures:
        args, oracle, actual = failures[0]
        print("DIFF", args)
        print("ORACLE", oracle)
        print("ACTUAL", actual)
        return 1
    print(f"verified {len(cases)} generated cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
