#!/usr/bin/env sh
set -eu

rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar

case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*) cp eza_port.py executable.py ;;
  *) cp eza_port.py executable && chmod +x executable ;;
esac
