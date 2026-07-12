#!/usr/bin/env sh
set -eu

rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar

case "$(uname -s 2>/dev/null || printf Windows)" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    printf '%s\n' '@echo off' 'python "%~dp0zip_password_finder_port.py" %*' > executable.cmd
    ;;
  *)
    cp zip_password_finder_port.py executable
    chmod +x executable
    ;;
esac
