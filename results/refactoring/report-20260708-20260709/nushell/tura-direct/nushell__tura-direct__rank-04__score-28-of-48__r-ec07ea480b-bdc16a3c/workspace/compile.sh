#!/usr/bin/env sh
set -eu

rm -f executable.exe executable.bat executable.js executable.jar
cp nushell_port.py executable
chmod +x executable 2>/dev/null || true

if command -v python >/dev/null 2>&1; then
  PY=python
else
  PY=python3
fi

printf '@echo off\r\n%s "%%~dp0nushell_port.py" %%*\r\n' "$PY" > executable.cmd
