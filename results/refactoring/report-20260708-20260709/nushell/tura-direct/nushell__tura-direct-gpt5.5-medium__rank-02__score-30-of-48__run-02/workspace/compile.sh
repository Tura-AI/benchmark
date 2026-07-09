#!/usr/bin/env sh
set -eu
if [ -f executable.cmd ]; then rm -f executable.cmd; fi
if [ -f executable.exe ]; then rm -f executable.exe; fi
cp nushell_port.py executable
chmod +x executable 2>/dev/null || true
python -m py_compile nushell_port.py
