#!/usr/bin/env python3
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / "executable"
WORK = ROOT / "verify-work"


def run(cmd, cwd):
    if cmd[0] == "PORT":
        cmd = [sys.executable, str(PORT), *cmd[1:]]
    else:
        cmd = [str(REF), *cmd]
    return subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def make_fixture(seed):
    rng = random.Random(seed)
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir()
    names = ["a", "B2", "b10", "file.txt", "space name", ".dot", "_under", "z9.log"]
    for name in names:
        p = WORK / name
        p.write_text("x" * rng.randint(0, 2048), encoding="utf-8")
    for d in ["dir", "Dir2", "empty"]:
        (WORK / d).mkdir()
    (WORK / "dir" / "child2").write_text("child", encoding="utf-8")
    (WORK / "dir" / "child10").write_text("child", encoding="utf-8")
    (WORK / "Dir2" / ".hidden-child").write_text("hidden", encoding="utf-8")


def valid_samples(rng):
    base_flags = [["--color=never", "--icons=never"]]
    views = [[], ["-l"], ["-T"], ["-la"], ["-aa"], ["--tree", "--level", "2"], ["--long", "--header"]]
    sorts = [[], ["--sort", "name"], ["--sort=size"], ["--sort=Name"], ["--sort=ext"], ["--sort=type"], ["--sort=none"], ["--reverse"]]
    filters = [[], ["--group-directories-first"], ["--group-directories-last"], ["--only-dirs"], ["--only-files"], ["--ignore-glob", "*.log|B*"]]
    for i in range(16):
        args = [*base_flags[0], *rng.choice(views), *rng.choice(sorts), *rng.choice(filters), str(WORK.name)]
        yield args


def invalid_samples(_rng):
    yield ["--color=never", "--icons=never", "--sort=colour", str(WORK.name)]
    yield ["--color=never", "--icons=never", "--tree", "--level", "nope", str(WORK.name)]
    yield ["--color=never", "--icons=never", "--tree", "-aa", str(WORK.name)]
    yield ["--color=never", "--icons=never", "--not-a-real-flag", str(WORK.name)]


def normalize(proc):
    stderr = proc.stderr.replace(b"\r\n", b"\n")
    stdout = proc.stdout.replace(b"\r\n", b"\n")
    return proc.returncode, stdout, stderr


def main():
    seed = os.environ.get("VERIFIER_SEED") or str(random.randrange(1 << 30))
    rng = random.Random(seed)
    make_fixture(seed)
    failures = []
    for args in [*valid_samples(rng), *invalid_samples(rng)]:
        ref = run(args, ROOT)
        got = run(["PORT", *args], ROOT)
        if normalize(ref) != normalize(got):
            failures.append((args, normalize(ref), normalize(got)))
            break
    if failures:
        args, ref, got = failures[0]
        print(f"seed={seed}")
        print(f"args={args!r}")
        print(f"ref={ref!r}")
        print(f"got={got!r}")
        return 1
    print(f"ok seed={seed} samples=20")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
