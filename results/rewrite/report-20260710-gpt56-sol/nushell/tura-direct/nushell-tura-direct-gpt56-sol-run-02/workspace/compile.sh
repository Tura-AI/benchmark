#!/usr/bin/env sh
set -eu
rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
chmod +x executable
python -m py_compile nushell_port.py executable
