#!/usr/bin/env sh
set -eu

rm -f executable executable.exe executable.cmd executable.bat \
      executable.js executable.py executable.jar

python -m py_compile xsv_core.py xsv_commands.py xsv_port.py

case "$(uname -s 2>/dev/null || printf Windows)" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    printf '%s\r\n' '@echo off' 'python "%~dp0xsv_port.py" %*' > executable.cmd
    ;;
  *)
    cp xsv_port.py executable
    chmod +x executable
    ;;
esac
