#!/usr/bin/env sh
set -eu

chmod +x ./executable 2>/dev/null || true

if [ ! -f ./executable.cmd ]; then
  cat > ./executable.cmd <<'EOF'
@echo off
set PYTHONIOENCODING=utf-8
python "%~dp0nushell_port.py" %*
EOF
fi

python -m py_compile ./nushell_port.py
