#!/usr/bin/env sh
set -eu
rm -f executable.exe executable.bat executable.js executable.jar
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    rm -f executable
    cat > executable.cmd <<'EOF'
@echo off
python "%~dp0eza_port.py" %*
EOF
    python -m py_compile eza_port.py
    ;;
  *)
    rm -f executable.cmd
    chmod +x executable 2>/dev/null || true
    python -m py_compile eza_port.py executable
    ;;
esac
