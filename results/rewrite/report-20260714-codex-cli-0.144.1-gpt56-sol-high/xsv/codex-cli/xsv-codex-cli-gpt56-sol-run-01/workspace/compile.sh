#!/usr/bin/env sh
set -eu

rm -f executable executable.exe executable.bat executable.js executable.py executable.jar

case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    # executable.cmd is tracked and is directly runnable by the Windows harness.
    test -f executable.cmd
    ;;
  *)
    cp xsv_port.py executable
    chmod +x executable
    ;;
esac
