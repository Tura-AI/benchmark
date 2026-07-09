#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.bat executable.js executable.jar executable.py
test -f xsv_port.py
cat > executable.cmd <<'EOF'
@echo off
py "%~dp0xsv_port.py" %*
EOF
