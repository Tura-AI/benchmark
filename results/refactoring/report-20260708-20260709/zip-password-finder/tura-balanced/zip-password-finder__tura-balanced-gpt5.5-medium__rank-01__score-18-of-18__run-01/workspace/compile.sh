#!/usr/bin/env sh
set -eu
rm -f executable
cat > executable.cmd <<'EOF'
@echo off
py -3 "%~dp0zip_password_finder.py" %*
exit /b %ERRORLEVEL%
EOF
