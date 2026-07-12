#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.bat executable.js executable.py executable.jar
test -f eza_port.py
test -f executable.cmd
