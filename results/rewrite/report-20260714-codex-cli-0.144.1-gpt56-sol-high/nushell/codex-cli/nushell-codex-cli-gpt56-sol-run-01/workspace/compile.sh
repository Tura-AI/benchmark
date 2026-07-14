#!/usr/bin/env sh
set -eu

rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar

platform=$(uname -s 2>/dev/null || printf unknown)
case "${OS:-}:$platform" in
Windows_NT:*|*:MINGW*|*:MSYS*|*:CYGWIN*)
    printf '@echo off\r\npython "%%~dp0main.py" %%*\r\n' > executable.cmd
    ;;
*)
    cp main.py executable
    chmod +x executable
    ;;
esac
