#!/usr/bin/env python3
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / "executable"

def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, text=False, input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def make_case_dir(seed):
    tmp = Path(tempfile.mkdtemp(prefix="eza-port-"))
    names = ["a", "b.txt", "Zed", "space name", ".hidden", "dir", "empty"]
    for name in names:
        p = tmp / name
        if name in {"dir", "empty"}:
            p.mkdir()
        else:
            p.write_bytes((name * (seed % 7)).encode())
    (tmp / "dir" / "nested.rs").write_text("fn main(){}")
    return tmp

def samples(rng):
    flags = [[], ["--oneline"], ["--long"], ["--long", "--header", "--no-user", "--no-time"], ["--tree"], ["--recurse"], ["--all"], ["--sort=size"], ["--reverse"], ["--classify=always"], ["--only-dirs"], ["--only-files"]]
    for i in range(16):
        yield flags[i % len(flags)]
    invalid = [["--sort=bogus"], ["--level=bad", "--tree"], ["--not-a-real-flag"], ["missing-file"]]
    for x in invalid:
        yield x

def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    case_dir = make_case_dir(rng.randrange(1_000_000))
    try:
        for argv in samples(rng):
            target = [] if argv == ["missing-file"] else [str(case_dir)]
            ref = run([str(REF), *argv, *target], ROOT)
            port = run([sys.executable, str(PORT), *argv, *target], ROOT)
            if (ref.returncode, ref.stdout, ref.stderr) != (port.returncode, port.stdout, port.stderr):
                print("mismatch", argv, file=sys.stderr)
                print("ref", ref.returncode, ref.stdout, ref.stderr, file=sys.stderr)
                print("port", port.returncode, port.stdout, port.stderr, file=sys.stderr)
                return 1
        return 0
    finally:
        shutil.rmtree(case_dir, ignore_errors=True)

if __name__ == "__main__":
    raise SystemExit(main())
