#!/usr/bin/env sh
set -eu
if [ ! -f executable ]; then
  cp zip_password_finder.py executable
fi
chmod +x executable 2>/dev/null || true
if [ -n "${OS:-}" ] && [ "$OS" = "Windows_NT" ]; then
  [ -f executable.cmd ]
else
  [ -f executable ]
fi
