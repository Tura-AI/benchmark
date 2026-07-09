#!/usr/bin/env sh
set -eu
rm -f executable.exe executable.bat executable.js executable.jar
if [ -f executable.cmd ]; then
  rm -f executable.cmd
fi
chmod +x executable 2>/dev/null || true
python -m py_compile zip_password_finder_port.py executable
