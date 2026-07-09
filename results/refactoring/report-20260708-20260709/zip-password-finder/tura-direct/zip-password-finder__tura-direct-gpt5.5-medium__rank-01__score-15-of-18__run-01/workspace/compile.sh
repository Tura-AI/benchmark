#!/usr/bin/env sh
set -eu
cp zip_password_finder_port.py executable
chmod +x executable 2>/dev/null || true
if [ "${OS:-}" = "Windows_NT" ]; then
  rm -f executable.exe executable.bat executable.js executable.py executable.jar
  cat > executable.cmd <<'EOF'
@echo off
py -3 "%~dp0zip_password_finder_port.py" %*
EOF
else
  rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
fi
