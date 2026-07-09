#!/usr/bin/env python3
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".tura" / "scripts"))
import diff_verify  # noqa: E402


def main():
    os.environ["NU_PORT_INVALID_SEMANTIC"] = "1"
    return diff_verify.main()


if __name__ == "__main__":
    raise SystemExit(main())
