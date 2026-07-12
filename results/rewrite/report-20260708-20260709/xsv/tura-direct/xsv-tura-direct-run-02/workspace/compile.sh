#!/usr/bin/env sh
set -eu
cat > executable.cmd <<'EOF'
@echo off
python "%~dp0xsv_py.py" %*
EOF
chmod +x executable.cmd 2>/dev/null || true
test -f executable.cmd
