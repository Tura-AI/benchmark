#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

rm -f executable executable.exe executable.cmd executable.bat \
  executable.js executable.py executable.jar

python -m py_compile eza_port.py

case "$(uname -s 2>/dev/null || printf unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    printf '@echo off\r\npython "%%~dp0eza_port.py" %%*\r\n' > executable.cmd
    [ -f executable.cmd ]
    ;;
  *)
    cp eza_port.py executable
    chmod +x executable
    [ -x executable ]
    ;;
esac
