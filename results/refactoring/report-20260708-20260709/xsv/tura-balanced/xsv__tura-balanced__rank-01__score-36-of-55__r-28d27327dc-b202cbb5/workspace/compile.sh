#!/usr/bin/env sh
set -eu

cp xsv_port.py executable
chmod +x executable 2>/dev/null || true

if command -v cmd.exe >/dev/null 2>&1; then
  cat > executable.cmd <<'EOF'
@echo off
python "%~dp0xsv_port.py" %*
EOF
fi
