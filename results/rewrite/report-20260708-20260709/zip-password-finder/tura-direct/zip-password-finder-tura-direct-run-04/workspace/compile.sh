#!/usr/bin/env sh
set -eu

case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*|Windows*|*_NT)
    rm -f executable executable.exe executable.bat executable.js executable.py executable.jar
    cat > executable.cmd <<'EOF'
@echo off
py -3 "%~dp0zip_password_finder_port.py" %*
EOF
    ;;
  *)
    rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
    cp zip_password_finder_port.py executable
    chmod +x executable
    ;;
esac
