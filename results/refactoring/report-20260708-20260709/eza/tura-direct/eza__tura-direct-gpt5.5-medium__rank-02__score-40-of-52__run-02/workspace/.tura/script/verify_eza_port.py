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
        argv = [sys.executable, str(PORT), *cmd[1:]]
    else:
        argv = [str(REF), *cmd[1:]]
    return subprocess.run(argv, cwd=cwd, text=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def make_tree(rng, base):
    names = ["a", "b", "c.txt", "Zed", "n10", "n2", ".hidden", "_winhidden", "space name"]
    rng.shuffle(names)
    for name in names[: rng.randint(5, len(names))]:
        p = base / name
        if "." in name and not name.startswith("."):
            p.write_text("x" * rng.randint(0, 20))
        elif rng.random() < 0.25:
            p.mkdir(exist_ok=True)
            (p / "child").write_text("kid")
        else:
            p.write_text("x" * rng.randint(0, 20))


def valid_args(rng):
    flag_groups = [
        [], ["-1"], ["-l"], ["-l", "--no-user"], ["-l", "--no-time"],
        ["-T"], ["-T", "-L", str(rng.randint(1, 3))], ["-a"], ["-aa"],
        ["--sort", rng.choice(["name", "Name", "size", "ext", "Extension", "type", "none"])],
        ["--reverse"], ["--group-directories-first"], ["--group-directories-last"],
        ["-I", rng.choice(["*.txt", "n*", "space*"])], ["-d"], ["--classify=always"],
    ]
    args = rng.choice(flag_groups) + ["--color=never", "--icons=never", "."]
    return args


def invalid_args(rng):
    return rng.choice([
        ["--definitely-unknown"], ["-Q"], ["--sort", "bogus"], ["-L"],
        ["-Taa", "--color=never", "--icons=never", "."],
    ])


def compare(args, cwd):
    r = run(["REF", *args], cwd)
    p = run(["PORT", *args], cwd)
    if (r.returncode, r.stdout, r.stderr) != (p.returncode, p.stdout, p.stderr):
        print("ARGS", args)
        print("REF", r.returncode, r.stdout.decode(errors="replace"), r.stderr.decode(errors="replace"))
        print("PORT", p.returncode, p.stdout.decode(errors="replace"), p.stderr.decode(errors="replace"))
        raise SystemExit(1)


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or None)
    with tempfile.TemporaryDirectory() as td:
        cwd = Path(td)
        make_tree(rng, cwd)
        for _ in range(16):
            compare(valid_args(rng), cwd)
        for _ in range(4):
            compare(invalid_args(rng), cwd)
    print("differential verifier passed")


if __name__ == "__main__":
    main()
