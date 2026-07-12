#!/usr/bin/env sh
set -eu
rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
cp xsv_port.py executable
chmod +x executable
