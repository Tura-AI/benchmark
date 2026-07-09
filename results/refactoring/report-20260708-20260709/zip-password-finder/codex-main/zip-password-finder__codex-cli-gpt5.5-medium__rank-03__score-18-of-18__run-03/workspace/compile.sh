#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.bat executable.js executable.jar
cat > executable.cmd <<'EOF'
@echo off
python "%~dp0zip_password_finder_port.py" %*
EOF
chmod +x executable.cmd 2>/dev/null || true
