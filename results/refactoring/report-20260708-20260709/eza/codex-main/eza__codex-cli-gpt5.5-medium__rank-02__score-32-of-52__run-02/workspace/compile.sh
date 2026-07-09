#!/usr/bin/env sh
set -eu

rm -f executable executable.exe executable.bat executable.js executable.jar
cp eza_port.py executable
chmod +x executable 2>/dev/null || true

cat > executable.cmd <<'EOF'
@echo off
python "%~dp0eza_port.py" %*
EOF
