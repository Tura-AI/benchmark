#!/usr/bin/env python3
import os
import random
import shutil
import string
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OFFICIAL = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = [sys.executable, str(ROOT / "executable")]


def safe_text(data):
    return data.decode("utf-8", "replace").encode("unicode_escape").decode("ascii")


def run(cmd, cwd, stdin=b"", env=None):
    merged = os.environ.copy()
    merged.update({"NO_COLOR": "1"})
    if env:
        merged.update(env)
    return subprocess.run(cmd, cwd=cwd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=merged)


def make_tree(base, rng):
    names = ["alpha", "Beta", "two words", "zeta.txt", "img.svg", "code.c", ".hidden"]
    for name in names:
        p = base / name
        if "." in name and name != ".hidden":
            p.write_text("x" * rng.randint(0, 80), encoding="utf-8")
        elif name.startswith("."):
            p.write_text("hidden", encoding="utf-8")
        else:
            p.mkdir()
            (p / ("child" + str(rng.randint(1, 99)) + ".txt")).write_text("child", encoding="utf-8")
    for i in range(8):
        text = "".join(rng.choice(string.ascii_letters + string.digits + "._-") for _ in range(rng.randint(1, 18)))
        (base / text).write_text("d" * rng.randint(0, 200), encoding="utf-8")


def valid_samples(rng, work):
    dirs = ["case"]
    files = ["case/zeta.txt", "case/img.svg", "case/code.c"]
    flags = [
        [], ["-1"], ["--grid", "--width", str(rng.randint(12, 120))], ["--across", "--width", "80"],
        ["--all"], ["--almost-all"], ["--only-dirs"], ["--only-files"], ["--group-directories-first"],
        ["--group-directories-last"], ["--reverse"], ["--sort", rng.choice(["name", "Name", "extension", "size", "modified", "type", "none"])],
        ["--classify=always"], ["--icons=always"], ["--absolute"], ["--absolute=off"],
        ["--long", "--no-user", "--no-time", "--no-filesize"],
        ["--long", "--no-user", "--no-time", "--no-permissions"],
        ["--long", "--header", "--no-user", "--no-time", "--no-filesize"],
        ["--tree", "--level", str(rng.randint(0, 3))], ["--recurse", "--level", str(rng.randint(1, 3))],
    ]
    for i in range(16):
        target = rng.choice(dirs + files)
        yield rng.choice(flags) + [target]


def invalid_samples(rng):
    bad = [["--not-a-real-flag"], ["-z"], ["--sort", "colour"], ["--width"], ["missing-file-" + str(rng.randint(100,999))]]
    rng.shuffle(bad)
    for sample in bad[:4]:
        yield sample


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    with tempfile.TemporaryDirectory(prefix="eza-port-") as td:
        work = Path(td)
        make_tree(work / "case", rng) if False else None
        (work / "case").mkdir()
        make_tree(work / "case", rng)
        samples = list(valid_samples(rng, work)) + list(invalid_samples(rng))
        failures = []
        for argv in samples:
            official = run([str(OFFICIAL), *argv], work)
            actual = run([*PORT, *argv], work)
            if (official.returncode, official.stdout, official.stderr) != (actual.returncode, actual.stdout, actual.stderr):
                failures.append((argv, official, actual))
                if len(failures) >= 8:
                    break
        if failures:
            for argv, official, actual in failures:
                print("ARGV", argv)
                print("official", official.returncode, safe_text(official.stdout), safe_text(official.stderr))
                print("actual  ", actual.returncode, safe_text(actual.stdout), safe_text(actual.stderr))
            return 1
    print(f"ok {len(samples)} generated samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
