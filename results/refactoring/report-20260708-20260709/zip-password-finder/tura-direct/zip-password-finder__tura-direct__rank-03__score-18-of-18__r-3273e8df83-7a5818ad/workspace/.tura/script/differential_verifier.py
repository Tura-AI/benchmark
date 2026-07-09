#!/usr/bin/env python3
import os
import random
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF = Path((ROOT / "REFERENCE_BINARY.txt").read_text().strip())
PORT = ROOT / ("executable.cmd" if os.name == "nt" else "executable")
PY = sys.executable


def run_cmd(argv):
    if os.name == "nt" and argv[0] == str(PORT):
        cmd = [str(PORT), *argv[1:]]
    else:
        cmd = argv
    p = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, norm(p.stdout), norm(p.stderr)


def norm(s):
    s = s.replace(str(PORT), str(REF)).replace("executable.cmd", "zip-password-finder.exe")
    s = re.sub(r"Time elapsed: .*", "Time elapsed: <elapsed>", s)
    return s


def write_dict(name, words):
    p = ROOT / ".tura" / "tmp" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\n".join(w.encode() for w in words) + b"\n")
    return str(p.relative_to(ROOT))


def valid_cases(rng):
    zips = ["2.test.txt.zip", "3.test.txt.zip", "4.test.txt.zip", "multi-file-with-dir.zip"]
    pw = {"2.test.txt.zip": "ab", "3.test.txt.zip": "abc", "4.test.txt.zip": "abcd", "multi-file-with-dir.zip": "ab"}
    for i in range(16):
        z = rng.choice(zips)
        zip_path = str(Path("rust-reference/test-files") / z)
        mode = i % 4
        if mode == 0:
            d = write_dict(f"dict{i}.txt", ["wrong", pw[z], "later"])
            yield ["--inputFile", zip_path, "--passwordDictionary", d]
        elif mode == 1:
            max_len = len(pw[z])
            yield ["--inputFile", zip_path, "--charset", "l", "--minPasswordLen", "1", "--maxPasswordLen", str(max_len), "--workers", "1"]
        elif mode == 2:
            yield ["--inputFile", zip_path, "--mask", "?l" * len(pw[z])]
        else:
            yield ["--inputFile", zip_path, "--mask", "?1?2", "--customCharset1", "a", "--customCharset2", "b"]


def invalid_cases():
    base = ["--inputFile", "rust-reference/test-files/2.test.txt.zip"]
    yield []
    yield ["--bad"]
    yield ["--inputFile", "missing.zip"]
    yield base + ["--charset", "x"]
    yield base + ["--minPasswordLen", "0"]
    yield base + ["--maxPasswordLen", "0"]
    yield base + ["--mask", "?z"]
    yield base + ["--mask", "?1"]


def main():
    rng = random.Random(os.environ.get("VERIFIER_SEED") or os.urandom(8))
    cases = [["--help"], ["-h"], ["--version"], *valid_cases(rng), *invalid_cases()]
    for idx, args in enumerate(cases, 1):
        ref = run_cmd([str(REF), *args])
        port = run_cmd([str(PORT), *args])
        if ref != port:
            print(f"case {idx} mismatch: {' '.join(args)}", file=sys.stderr)
            print("REF", ref, file=sys.stderr)
            print("PORT", port, file=sys.stderr)
            return 1
    print(f"differential verifier passed {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
