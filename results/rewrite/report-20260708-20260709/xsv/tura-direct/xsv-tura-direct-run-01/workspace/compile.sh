#!/usr/bin/env sh
set -eu

cp xsv_port.py executable
chmod +x executable 2>/dev/null || true

cat > executable.cmd <<'EOF'
@echo off
python "%~dp0xsv_port.py" %*
EOF
