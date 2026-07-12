#!/usr/bin/env sh
set -eu
rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
python -m py_compile eza_port.py executable
chmod +x executable
