#!/usr/bin/env python3
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OFFICIAL = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / "executable"


def run(cmd, cwd, stdin=b""):
    return subprocess.run(cmd, cwd=cwd, input=stdin, capture_output=True)


def make_tree(base, rng):
    names = ["alpha", "Beta", "space name", ".hidden", "image.svg", "n.log"]
    for n in names:
        p = base / n
        p.write_text("x" * rng.randrange(0, 80), encoding="utf-8")
    for d in ["dir", "zdir", ".hdir"]:
        q = base / d
        q.mkdir()
        (q / "child.txt").write_text("child", encoding="utf-8")
    try:
        os.symlink("alpha", base / "alink")
    except OSError:
        pass


def valid_sample(rng, i):
    opts = [[], ["-1"], ["-l", "--no-user", "--no-time", "--no-filesize", "--no-permissions"],
            ["-T"], ["-R", "--level", str(rng.randrange(1, 3))], ["--icons=always"],
            ["--classify=always"], ["--only-dirs"], ["--only-files"], ["--sort", rng.choice(["name", "size", "extension", "none"])],
            ["--reverse"], ["--group-directories-first"], ["-a"], ["-aa"], ["--absolute"], ["-d"]]
    return opts[i % len(opts)] + ["."]


def invalid_sample(rng, i):
    return [["--definitely-invalid"], ["--sort", "bogus"], ["--level", "nan"], ["missing-path"]][i % 4]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    failures = []
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        make_tree(work, rng)
        samples = [valid_sample(rng, i) for i in range(16)] + [invalid_sample(rng, i) for i in range(4)]
        for args in samples:
            o = run([str(OFFICIAL), *args], work)
            p = run([sys.executable, str(PORT), *args], work)
            if (o.returncode, o.stdout, o.stderr) != (p.returncode, p.stdout, p.stderr):
                failures.append((args, (o.returncode, o.stdout, o.stderr), (p.returncode, p.stdout, p.stderr)))
    if failures:
        for args, o, p in failures[:5]:
            print("FAIL", args)
            print("official", repr(o))
            print("port    ", repr(p))
        return 1
    print("ok: 16 valid and 4 invalid generated samples matched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
