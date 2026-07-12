#!/usr/bin/env sh
set -eu

python -m py_compile nushell_port.py executable
chmod +x executable 2>/dev/null || true

# Remove lower-priority entrypoints that could mask the Python executable.
rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
