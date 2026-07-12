#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.bat executable.js executable.py executable.jar
cat > executable.cmd <<'EOF'
@echo off
python "%~dp0eza_port.py" %*
EOF
