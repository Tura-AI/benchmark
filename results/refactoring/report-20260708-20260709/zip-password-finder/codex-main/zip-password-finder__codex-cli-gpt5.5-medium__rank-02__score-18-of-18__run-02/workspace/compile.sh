#!/usr/bin/env sh
set -eu

cat > executable.cmd <<'EOF'
@echo off
python "%~dp0zip_password_finder_port.py" %*
EOF

chmod +x executable 2>/dev/null || true
