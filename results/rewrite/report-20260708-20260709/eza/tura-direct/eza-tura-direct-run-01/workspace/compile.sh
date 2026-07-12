#!/usr/bin/env sh
set -eu
chmod +x executable 2>/dev/null || true
rm -f executable.exe executable.cmd executable.bat executable.js executable.jar
python -m py_compile eza_port.py executable
