import os
import random
import re
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = [sys.executable, os.path.join(ROOT, "zip_password_finder.py")]
FIXTURES = os.path.join(ROOT, "rust-reference", "test-files")


def run(cmd):
    p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    return p.returncode, normalize(p.stdout), normalize(p.stderr)


def normalize(text):
    text = text.replace("\r\n", "\n")
    text = re.sub(r"Time elapsed: [^\n]+", "Time elapsed: <elapsed>", text)
    text = re.sub(r"Usage: zip-password-finder(?:\.exe|\.py)?", "Usage: zip-password-finder.exe", text)
    return text


def oracle(argv):
    return run([REF] + argv)


def actual(argv):
    return run(PORT + argv)


def compare(name, argv):
    exp = oracle(argv)
    got = actual(argv)
    if exp != got:
        print(f"FAIL {name}: {' '.join(argv)}")
        print("expected:", repr(exp))
        print("actual:  ", repr(got))
        raise SystemExit(1)


def valid_bruteforce(rng, i):
    zip_name, pwd = rng.choice([("2.test.txt.zip", "ab"), ("3.test.txt.zip", "abc"), ("4.test.txt.zip", "abcd")])
    max_len = rng.randint(len(pwd), len(pwd) + 1)
    min_len = rng.randint(1, len(pwd))
    argv = ["-i", os.path.join(FIXTURES, zip_name), "-w", "1", "-c", "l", "--minPasswordLen", str(min_len), "--maxPasswordLen", str(max_len)]
    if i % 5 == 0:
        argv += ["--startingPassword", pwd[:-1] + "a"]
    return argv


def valid_dictionary(rng, _i):
    zip_name = rng.choice(["2.test.txt.zip", "3.test.txt.zip", "4.test.txt.zip"])
    return ["-i", os.path.join(FIXTURES, zip_name), "-w", "1", "-p", os.path.join(FIXTURES, "generated-passwords-lowercase.txt")]


def valid_mask(rng, _i):
    zip_name, masks = rng.choice([
        ("2.test.txt.zip", ["?l?l", "a?l", "?1?l"]),
        ("3.test.txt.zip", ["?l?l?l", "a?l?l", "?1?l?l"]),
    ])
    mask = rng.choice(masks)
    argv = ["-i", os.path.join(FIXTURES, zip_name), "-w", "1", "--mask", mask]
    if "?1" in mask:
        argv += ["-1", "abc"]
    return argv


def invalid_args(rng, i):
    existing = os.path.join(FIXTURES, "2.test.txt.zip")
    cases = [
        ["-i", os.path.join(FIXTURES, "missing.zip")],
        ["-i", existing, "--workers", "0"],
        ["-i", existing, "--minPasswordLen", "0"],
        ["-i", existing, "--maxPasswordLen", "0"],
        ["-i", existing, "--minPasswordLen", "3", "--maxPasswordLen", "2"],
        ["-i", existing, "-c", "x", "--maxPasswordLen", "1"],
        ["-i", existing, "--mask", "?z"],
        ["-i", existing, "--mask", "?1"],
        ["-i", existing, "-1", "abc"],
        ["-i", existing, "-p", os.path.join(FIXTURES, "missing.txt")],
        ["-i", existing, "-p", os.path.join(FIXTURES, "generated-passwords-lowercase.txt"), "--startingPassword", "a"],
        ["-i", existing, "--mask", "?l", "--startingPassword", "a"],
    ]
    return cases[(i + rng.randrange(len(cases))) % len(cases)]


def original_test_cases():
    return [
        ["-i", os.path.join(FIXTURES, "2.test.txt.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "2"],
        ["-i", os.path.join(FIXTURES, "2.test.txt.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "1"],
        ["-i", os.path.join(FIXTURES, "3.test.txt.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "3"],
        ["-i", os.path.join(FIXTURES, "3.test.txt.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "2"],
        ["-i", os.path.join(FIXTURES, "4.test.txt.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "4"],
        ["-i", os.path.join(FIXTURES, "multi-file-with-dir.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "2", "--fileNumber", "0"],
        ["-i", os.path.join(FIXTURES, "multi-file-with-dir.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "2", "--fileNumber", "1"],
        ["-i", os.path.join(FIXTURES, "multi-file-with-dir.zip"), "-w", "1", "-c", "l", "--maxPasswordLen", "2", "--fileNumber", "99"],
        ["-i", os.path.join(FIXTURES, "2.test.txt.zip"), "-w", "1", "--mask", "?l?l"],
        ["-i", os.path.join(FIXTURES, "3.test.txt.zip"), "-w", "1", "--mask", "?l?l?l"],
        ["-i", os.path.join(FIXTURES, "2.test.txt.zip"), "-w", "1", "--mask", "a?l"],
        ["-i", os.path.join(FIXTURES, "2.test.txt.zip"), "-w", "1", "--mask", "?d?d"],
    ]


def main():
    seed = os.environ.get("VERIFIER_SEED", str(random.randrange(1 << 30)))
    print(f"seed={seed}")
    rng = random.Random(seed)
    for n, case in enumerate(original_test_cases()):
        compare(f"original-{n}", case)
    groups = [valid_bruteforce, valid_dictionary, valid_mask]
    for group in groups:
        for i in range(16):
            argv = group(rng, i)
            assert os.path.isfile(argv[1])
            compare(group.__name__ + f"-{i}", argv)
    for i in range(12):
        compare(f"invalid-{i}", invalid_args(rng, i))
    print("ok")


if __name__ == "__main__":
    main()
