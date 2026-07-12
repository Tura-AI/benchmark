#!/usr/bin/env python3
"""Create the highest-priority runnable entrypoint for the current OS."""

from __future__ import annotations

import os
import pathlib
import shutil


ROOT = pathlib.Path(__file__).resolve().parent
STALE = (
    "executable",
    "executable.exe",
    "executable.bat",
    "executable.js",
    "executable.py",
    "executable.jar",
)


for name in STALE:
    path = ROOT / name
    if path.exists() or path.is_symlink():
        path.unlink()

if os.name == "nt":
    if not (ROOT / "executable.cmd").is_file():
        raise SystemExit("missing Windows entrypoint: executable.cmd")
else:
    command = ROOT / "executable"
    shutil.copyfile(ROOT / "eza_port.py", command)
    command.chmod(0o755)
    (ROOT / "executable.cmd").unlink(missing_ok=True)
