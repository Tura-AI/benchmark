#!/usr/bin/env sh
set -eu

# Keep the highest-priority evaluator entrypoint unambiguous for Python.
rm -f executable executable.exe executable.bat executable.js executable.jar

if [ "${OS:-}" = "Windows_NT" ] || command -v cmd.exe >/dev/null 2>&1; then
  cat > executable.cmd <<'EOF'
@echo off
python "%~dp0xsv_port.py" %*
EOF
else
  cp xsv_port.py executable
  chmod +x executable
fi

python -m py_compile xsv_port.py
