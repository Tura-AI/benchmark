#!/bin/sh
set -eu
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.jar
cp nushell_port.py executable.py
if [ "${OS:-}" = "Windows_NT" ]; then
  cat > executable.cmd <<'EOF'
@echo off
python "%~dp0executable.py" %*
EOF
else
  cp nushell_port.py executable
  chmod +x executable
fi
