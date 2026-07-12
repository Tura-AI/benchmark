#!/usr/bin/env sh
set -eu
rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
test -f zip_password_finder_port.py
test -f executable
chmod +x executable
python3 -m py_compile zip_password_finder_port.py executable
