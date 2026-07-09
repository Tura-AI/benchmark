import os
import random
import re
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PY = sys.executable
PORT = os.path.join(ROOT, "executable")


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, normalize(p.stdout), normalize(p.stderr)


def normalize(data):
    text = data.decode("utf-8", "replace")
    text = re.sub(r"Time elapsed: .*\r?\n", "Time elapsed: <normalized>\n", text)
    text = text.replace("zip-password-finder.exe", "zip-password-finder.exe")
    return text


def valid_samples(rng):
    z2 = "rust-reference/test-files/2.test.txt.zip"
    z3 = "rust-reference/test-files/3.test.txt.zip"
    z4 = "rust-reference/test-files/4.test.txt.zip"
    multi = "rust-reference/test-files/multi-file-with-dir.zip"
    dictp = "rust-reference/test-files/generated-passwords-lowercase.txt"
    yield ["--version"]
    yield ["--help"]
    masks = ["?l?l", "a?l", "?1?l", "??", "?h?H", "?d?d", "?a"]
    for i in range(16):
        mode = i % 4
        if mode == 0:
            yield ["-i", rng.choice([z2, multi]), "-p", dictp, "--fileNumber", str(rng.randrange(0, 3))]
        elif mode == 1:
            max_len = rng.choice([1, 2, 3, 4])
            yield ["-i", rng.choice([z2, z3, z4]), "-c", rng.choice(["l", "d", "h", "lu", "lud"]), "--minPasswordLen", "1", "--maxPasswordLen", str(max_len)]
        elif mode == 2:
            m = rng.choice(masks)
            args = ["-i", z2, "--mask", m]
            if "?1" in m:
                args += ["-1", rng.choice(["ab", "?l", "?d"])]
            yield args
        else:
            yield ["-i", z2, "--charsetFile", "rust-reference/test-files/file-charset.txt", "--minPasswordLen", "1", "--maxPasswordLen", "2"]


def invalid_samples(rng):
    z2 = "rust-reference/test-files/2.test.txt.zip"
    return [
        ["--bad"],
        ["-i"],
        ["-i", "missing.zip"],
        ["-i", z2, "--fileNumber", "bad"],
        ["-i", z2, "--minPasswordLen", "0"],
        ["-i", z2, "--minPasswordLen", "2", "--maxPasswordLen", "1"],
        ["-i", z2, "-p", "missing.txt"],
        ["-i", z2, "--charset", "x"],
        ["-i", z2, "--mask", "?z"],
        ["-i", z2, "--mask", "?1"],
        ["-i", z2, "--mask", "?"],
        ["-i", z2, "--workers", "0"],
    ]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or os.urandom(16))
    samples = list(valid_samples(rng)) + invalid_samples(rng)
    for args in samples:
        oracle = run([REF] + args)
        actual = run([PY, PORT] + args)
        if oracle != actual:
            print("DIFF", args)
            print("oracle", oracle)
            print("actual", actual)
            return 1
    print(f"ok {len(samples)} samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
