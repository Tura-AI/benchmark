#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.jar
if command -v python >/dev/null 2>&1; then
  PY=python
else
  PY=python3
fi
"$PY" -m py_compile nushell_port.py executable.py
IS_WINDOWS=$("$PY" - <<'PY'
import platform
print("yes" if platform.system().lower().startswith("windows") else "no")
PY
)
if [ "$IS_WINDOWS" = "yes" ]; then
  cat > executable.cmd <<'EOF'
@echo off
python "%~dp0executable.py" %*
EOF
else
  cp executable.py executable
  chmod +x executable
fi
