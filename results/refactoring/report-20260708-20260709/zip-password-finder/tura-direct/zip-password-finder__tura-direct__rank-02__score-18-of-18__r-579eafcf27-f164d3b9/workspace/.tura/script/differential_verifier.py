#!/usr/bin/env python3
import os
import random
import re
import subprocess
import sys
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def python_cmd():
    for cmd in (["python3"], ["python"], ["py", "-3"]):
        try:
            subprocess.run(cmd + ["--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return cmd
        except Exception:
            pass
    raise RuntimeError("no Python interpreter found")


PY = python_cmd()
REF = open(os.path.join(ROOT, "REFERENCE_BINARY.txt"), encoding="utf-8").read().strip()
PORT = PY + [os.path.join(ROOT, "executable")]
TIME_RE = re.compile(rb"^Time elapsed: .*$", re.M)


def run(cmd, args):
    return subprocess.run(cmd + args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def norm(proc):
    return (proc.returncode, TIME_RE.sub(b"Time elapsed: <elapsed>", proc.stdout), proc.stderr)


def dictionary_sample(rng, index, tmpdir):
    zip_path = "rust-reference/test-files/2.test.txt.zip"
    candidates = [b"", b"aa", b"zz", b"ab", b"abc", b"a b", b"??"]
    rng.shuffle(candidates)
    if index % 4 == 0 and b"ab" in candidates:
        candidates.remove(b"ab")
    path = os.path.join(tmpdir, f"dict_{index}.txt")
    newline = b"\r\n" if index % 3 == 0 else b"\n"
    with open(path, "wb") as fh:
        fh.write(newline.join(candidates) + newline)
    return ["-i", zip_path, "-p", os.path.relpath(path, ROOT), "-w", str(rng.choice([1, 2, 3]))]


def bruteforce_sample(rng, index, tmpdir):
    del tmpdir
    zip_path = "rust-reference/test-files/2.test.txt.zip"
    charset = rng.choice(["l", "d", "h", "ld"])
    args = ["-i", zip_path, "-c", charset, "--minPasswordLen", "1", "--maxPasswordLen", "2", "-w", str(rng.choice([1, 2, 4]))]
    if index % 5 == 0 and charset in ("l", "h", "ld"):
        args += ["-s", rng.choice(["a", "ab"])]
    return args


def mask_sample(rng, index, tmpdir):
    del tmpdir
    zip_path = "rust-reference/test-files/2.test.txt.zip"
    masks = ["?l?l", "a?l", "?1?l", "?l?1", "??", "zz", "?h?d", "a?2"]
    mask = rng.choice(masks)
    args = ["-i", zip_path, "-m", mask]
    if "?1" in mask:
        args += ["--customCharset1", rng.choice(["ab", "?l", "a?"])]
    if "?2" in mask:
        args += ["--customCharset2", rng.choice(["b", "?d", "xz"])]
    return args


def archive_sample(rng, index, tmpdir):
    del tmpdir
    if index % 2 == 0:
        return ["-i", "rust-reference/test-files/multi-file-with-dir.zip", "-m", rng.choice(["?d", "?l"]), "--fileNumber", str(rng.choice([0, 1, 99]))]
    return ["-i", rng.choice(["rust-reference/test-files/3.test.txt.zip", "rust-reference/test-files/4.test.txt.zip"]), "-m", rng.choice(["?l?l?l", "abc", "zz"]), "-w", "1"]


def invalid_sample(rng, index):
    cases = [
        ["-i", "missing.zip"],
        ["-i", "rust-reference/test-files/2.test.txt.zip", "-c", "x", "--maxPasswordLen", "1"],
        ["-i", "rust-reference/test-files/2.test.txt.zip", "--minPasswordLen", "3", "--maxPasswordLen", "1"],
        ["-i", "rust-reference/test-files/2.test.txt.zip", "-m", "?1"],
        ["rust-reference/test-files/2.test.txt.zip"],
    ]
    return cases[index % len(cases)]


def finite_metadata_samples():
    return [["-h"], ["--help"], ["-V"], ["--version"]]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or os.urandom(16))
    groups = [
        ("dictionary", dictionary_sample, 16),
        ("bruteforce", bruteforce_sample, 16),
        ("mask", mask_sample, 16),
        ("archive", archive_sample, 16),
    ]
    checked = 0
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, ".tura")) as tmpdir:
        samples = []
        for name, generator, count in groups:
            for i in range(count):
                samples.append((name, generator(rng, i, tmpdir)))
        for i in range(4):
            samples.append(("invalid", invalid_sample(rng, i)))
        for args in finite_metadata_samples():
            samples.append(("metadata", args))
        for i, (name, args) in enumerate(samples, 1):
            expected = norm(run([REF], args))
            actual = norm(run(PORT, args))
            if expected != actual:
                print(f"mismatch {name} sample {i}: {' '.join(args)}", file=sys.stderr)
                print(f"expected={expected!r}", file=sys.stderr)
                print(f"actual={actual!r}", file=sys.stderr)
                return 1
            checked += 1
    print(f"differential verifier passed: {checked} generated/finite samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
