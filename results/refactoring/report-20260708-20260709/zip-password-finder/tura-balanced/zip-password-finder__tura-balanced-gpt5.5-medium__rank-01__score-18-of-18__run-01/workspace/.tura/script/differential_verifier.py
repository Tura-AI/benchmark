import os
import random
import re
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = os.path.join(ROOT, "executable.cmd")
FIX = os.path.join(ROOT, "rust-reference", "test-files")


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=20)


def norm(res):
    out = res.stdout.replace("\r\n", "\n")
    err = res.stderr.replace("\r\n", "\n")
    out = re.sub(r"Time elapsed: .*\n", "Time elapsed: <elapsed>\n", out)
    return res.returncode, out, err


def valid_cases(rng):
    z2 = os.path.join(FIX, "2.test.txt.zip")
    z3 = os.path.join(FIX, "3.test.txt.zip")
    multi = os.path.join(FIX, "multi-file-with-dir.zip")
    dict_file = os.path.join(FIX, "generated-passwords-lowercase.txt")
    charset_file = os.path.join(FIX, "file-charset.txt")
    chars = ["l", "d", "h", "H", "ld", "lud"]
    masks = ["?l?l", "a?l", "?1?l", "??", "?d?d", "?h"]
    for i in range(16):
        kind = i % 6
        if kind == 0:
            yield ["-i", z2, "-c", rng.choice(chars), "--minPasswordLen", "1", "--maxPasswordLen", str(rng.choice([1, 2])), "--workers", "1"]
        elif kind == 1:
            yield ["-i", z2, "-p", dict_file, "--workers", "1"]
        elif kind == 2:
            mask = rng.choice(masks)
            case = ["-i", z2, "--mask", mask, "--workers", "1"]
            if "?1" in mask:
                case += ["--customCharset1", "a"]
            yield case
        elif kind == 3:
            yield ["-i", z3, "-c", "l", "--minPasswordLen", "2", "--maxPasswordLen", "3", "--startingPassword", rng.choice(["aa", "ab", "ba"]), "--workers", "1"]
        elif kind == 4:
            yield ["-i", multi, "-c", "l", "--minPasswordLen", "1", "--maxPasswordLen", "2", "--fileNumber", str(rng.choice([0, 1, 99])), "--workers", "1"]
        else:
            yield ["-i", z2, "--charsetFile", charset_file, "--minPasswordLen", "1", "--maxPasswordLen", "1", "--workers", "1"]


def invalid_cases(rng):
    z2 = os.path.join(FIX, "2.test.txt.zip")
    dict_file = os.path.join(FIX, "generated-passwords-lowercase.txt")
    pool = [
        [],
        ["-i", "missing.zip"],
        ["-i", z2, "--workers", "0"],
        ["-i", z2, "--minPasswordLen", "0"],
        ["-i", z2, "--minPasswordLen", "3", "--maxPasswordLen", "2"],
        ["-i", z2, "--charset", "x", "--maxPasswordLen", "1"],
        ["-i", z2, "--mask", "?z"],
        ["-i", z2, "--customCharset1", "abc"],
        ["-i", z2, "--mask", "?1"],
        ["-i", z2, "--mask", "?l", "-p", dict_file],
        ["-i", z2, "-p", dict_file, "--startingPassword", "a"],
    ]
    rng.shuffle(pool)
    for case in pool[:4]:
        yield case


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or os.urandom(8))
    cases = list(valid_cases(rng)) + list(invalid_cases(rng))
    for idx, args in enumerate(cases, 1):
        oracle = norm(run([REF] + args))
        actual = norm(run([PORT] + args))
        if oracle != actual:
            print(f"case {idx} mismatch", file=sys.stderr)
            print("args:", args, file=sys.stderr)
            print("oracle:", oracle, file=sys.stderr)
            print("actual:", actual, file=sys.stderr)
            return 1
    print(f"verified {len(cases)} generated CLI cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
