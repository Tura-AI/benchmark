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
    if cmd[0] == "PORT":
        full = [sys.executable, str(PORT)] + cmd[1:]
    else:
        full = [str(REF)] + cmd[1:]
    env = os.environ.copy()
    env.update({"NO_COLOR": "1", "CLICOLOR": "0"})
    return subprocess.run(full, cwd=cwd, input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=10)


def make_tree(base, rng):
    names = ["a", "b", "A2", "a10", ".hidden", "_under", "file.txt", "z.log", "image.png"]
    rng.shuffle(names)
    for i, name in enumerate(names[: rng.randint(5, len(names))]):
        p = base / name
        p.write_bytes((name * (i + 1)).encode())
    for d in ["dir", "Dir2", ".dotdir"]:
        dp = base / d
        dp.mkdir(exist_ok=True)
        for j in range(rng.randint(1, 4)):
            (dp / f"child{j}.txt").write_text("x" * rng.randint(0, 20))


def valid_samples(rng, base):
    option_sets = [
        ["--color", "never", "--icons", "never", "--oneline"],
        ["--color=never", "--icons=never", "--long", "--no-user", "--no-time"],
        ["--color=never", "--icons=never", "--long", "--no-user", "--no-time", "--bytes"],
        ["--color=never", "--icons=never", "--tree", "--level", "2"],
        ["--color=never", "--icons=never", "--all", "--oneline"],
        ["--color=never", "--icons=never", "--almost-all", "--oneline"],
        ["--color=never", "--icons=never", "--sort", "size", "--oneline"],
        ["--color=never", "--icons=never", "--sort", "extension", "--oneline"],
        ["--color=never", "--icons=never", "--group-directories-first", "--oneline"],
        ["--color=never", "--icons=never", "--classify", "always", "--oneline"],
    ]
    for i in range(16):
        opts = list(rng.choice(option_sets))
        target = "." if i % 3 else str(base / "dir")
        yield opts + [target]


def invalid_samples(base):
    return [
        ["--sort", "nonsense", str(base)],
        ["--color=bogus", str(base)],
        ["--tree", "--level=bad", str(base)],
        [str(base / "missing")],
    ]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED", str(random.randrange(1 << 30))))
    with tempfile.TemporaryDirectory(prefix="eza-port-") as td:
        base = Path(td) / "case"
        base.mkdir()
        make_tree(base, rng)
        cases = list(valid_samples(rng, base)) + invalid_samples(base)
        failures = []
        for argv in cases:
            ref = run(["REF"] + argv, base)
            port = run(["PORT"] + argv, base)
            if (ref.returncode, ref.stdout, ref.stderr) != (port.returncode, port.stdout, port.stderr):
                failures.append((argv, ref, port))
                if len(failures) >= 5:
                    break
        if failures:
            for argv, ref, port in failures:
                print("FAIL", argv)
                print("ref", ref.returncode, ref.stdout.decode(errors="replace"), ref.stderr.decode(errors="replace"))
                print("port", port.returncode, port.stdout.decode(errors="replace"), port.stderr.decode(errors="replace"))
            return 1
    print(f"ok {len(cases)} generated oracle comparisons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
