#!/usr/bin/env sh
set -eu
chmod +x eza_py.py 2>/dev/null || true
if [ ! -f executable.cmd ]; then
  printf '%s\n' '@echo off' 'python "%~dp0eza_py.py" %*' > executable.cmd
fi
[ -f eza_py.py ]
[ -f executable.cmd ]
