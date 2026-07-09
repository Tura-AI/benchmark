#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.jar
if command -v python >/dev/null 2>&1; then
  PY=python
else
  PY=python3
fi
cp nushell_port.py executable
chmod +x executable 2>/dev/null || true
"$PY" -m py_compile nushell_port.py
