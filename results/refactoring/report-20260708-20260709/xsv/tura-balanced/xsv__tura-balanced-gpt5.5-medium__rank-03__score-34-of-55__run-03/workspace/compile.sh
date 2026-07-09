#!/bin/sh
''':'
exec python "$0" "$@"
':'''
import os
import py_compile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
for name in ("xsv_port.py", "executable"):
    py_compile.compile(str(ROOT / name), doraise=True)

try:
    os.chmod(ROOT / "executable", 0o755)
except OSError:
    pass
