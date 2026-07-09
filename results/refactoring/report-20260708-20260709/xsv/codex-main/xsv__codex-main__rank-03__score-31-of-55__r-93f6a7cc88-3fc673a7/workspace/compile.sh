#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.bat executable.js executable.jar
cat > executable.cmd <<'EOF'
@echo off
python "%~dp0xsv_port.py" %*
EOF
chmod +x executable.cmd 2>/dev/null || true
python -m py_compile xsv_port.py
