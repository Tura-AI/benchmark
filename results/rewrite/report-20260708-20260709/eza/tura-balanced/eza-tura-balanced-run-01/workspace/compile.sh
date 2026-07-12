#!/usr/bin/env sh
set -eu
rm -f executable.cmd executable.bat executable.exe executable.js executable.py executable.jar
[ -f eza_port.py ]
[ -f executable ]
chmod +x executable 2>/dev/null || true
python -m py_compile eza_port.py executable
