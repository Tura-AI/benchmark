#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
case "$(uname -s 2>/dev/null || printf unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    printf '%s\r\n' '@echo off' 'python "%~dp0main.py" %*' > executable.cmd
    ;;
  *)
    cp main.py executable
    chmod +x executable
    ;;
esac
python -m py_compile main.py
