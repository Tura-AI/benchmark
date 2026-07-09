#!/usr/bin/env sh
set -eu

case "$(uname -s 2>/dev/null || printf unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    rm -f executable executable.exe executable.bat executable.js executable.py executable.jar
    printf '@echo off\r\npython "%%~dp0zip_password_finder_port.py" %%*\r\n' > executable.cmd
    ;;
  *)
    rm -f executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
    cp zip_password_finder_port.py executable
    chmod +x executable
    ;;
esac
