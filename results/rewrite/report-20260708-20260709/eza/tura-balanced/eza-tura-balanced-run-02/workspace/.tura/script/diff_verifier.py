import os
import random
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BIN = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]
TMP = ROOT / ".tura" / "tmp" / "diff-fixture"


def run(cmd, cwd, stdin=b""):
    return subprocess.run(cmd, cwd=cwd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def reset_fixture(seed):
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    rng = random.Random(seed)
    names = ["alpha.txt", "Beta.TXT", "space name.md", ".hidden", "zeta", "n.log"]
    for i, name in enumerate(names):
        data = (name + "\n") * (1 + rng.randrange(20))
        p = TMP / name
        p.write_text(data, encoding="utf-8")
        stamp = 1_700_000_000 + i * 173 + rng.randrange(90)
        os.utime(p, (stamp, stamp))
    for d in ["dir-a", "DirB", ".hdir"]:
        (TMP / d).mkdir()
        (TMP / d / "child.txt").write_text(d, encoding="utf-8")
    try:
        (TMP / "link-alpha").symlink_to("alpha.txt")
    except OSError:
        pass
    return TMP


def samples(seed):
    rng = random.Random(seed)
    valid_flags = [
        ["."], [".", "-1"], [".", "-a", "-1"], [".", "-aa", "-1"],
        [".", "--sort", "size", "-1"], [".", "--sort", "Ext", "-1"],
        [".", "--reverse", "-1"], [".", "--only-dirs", "-1"],
        [".", "--only-files", "-1"], [".", "--ignore-glob", "*.log|Beta*", "-1"],
        [".", "-l", "--no-user", "--no-time", "--color", "never"],
        [".", "-l", "--header", "--no-user", "--no-time", "--no-filesize", "--color", "never"],
        [".", "-l", "--bytes", "--no-user", "--no-time", "--color", "never"],
        [".", "-T", "--level", "1", "--color", "never"],
        [".", "--absolute", "on", "-1", "--color", "never"],
        ["alpha.txt", "missing", "dir-a", "-1", "--color", "never"],
    ]
    for _ in range(16):
        base = rng.choice(valid_flags)
        yield True, base
    invalid = [
        ["--sort", "bad"], ["--width", "nope"], ["--definitely-not-eza"], ["missing-path"],
    ]
    for item in invalid:
        yield False, item


def main():
    seed = int(os.environ.get("VERIFIER_SEED", "8675309"))
    cwd = reset_fixture(seed)
    failures = []
    count_valid = count_invalid = 0
    for valid, argv in samples(seed):
        if valid:
            count_valid += 1
        else:
            count_invalid += 1
        oracle = run([str(BIN), *argv], cwd)
        actual = run([*PORT, *argv], cwd)
        if (oracle.returncode, oracle.stdout, oracle.stderr) != (actual.returncode, actual.stdout, actual.stderr):
            failures.append((argv, oracle.returncode, actual.returncode, oracle.stdout, actual.stdout, oracle.stderr, actual.stderr))
    if failures:
        print(f"FAIL {len(failures)} cases; valid={count_valid} invalid={count_invalid}")
        for f in failures[:8]:
            argv, oe, ae, osout, asout, oerr, aerr = f
            print("ARGV", argv)
            print("EXIT", oe, ae)
            print("STDOUT_ORACLE", osout.decode("utf-8", "replace"))
            print("STDOUT_ACTUAL", asout.decode("utf-8", "replace"))
            print("STDERR_ORACLE", oerr.decode("utf-8", "replace"))
            print("STDERR_ACTUAL", aerr.decode("utf-8", "replace"))
        return 1
    print(f"PASS generated differential verifier valid={count_valid} invalid={count_invalid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
