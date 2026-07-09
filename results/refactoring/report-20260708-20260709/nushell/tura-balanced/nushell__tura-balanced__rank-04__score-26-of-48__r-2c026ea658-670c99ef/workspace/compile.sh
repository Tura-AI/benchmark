#!/usr/bin/env sh
set -eu

# Keep the highest-priority Windows entrypoint directly runnable by cmd.exe and
# avoid leaving a POSIX shell file named ./executable ahead of it.
rm -f executable executable.exe executable.bat executable.js executable.jar

cat > executable.cmd <<'EOF'
@echo off
setlocal
python "%~dp0nushell_port.py" %*
exit /b %ERRORLEVEL%
EOF

chmod +x nushell_port.py 2>/dev/null || true
