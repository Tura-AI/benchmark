#!/usr/bin/env sh
set -eu
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
python -m py_compile nushell_port.py compat_verify.py
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) cp launcher.cmd executable.cmd ;;
  *) cp nushell_port.py executable; chmod +x executable ;;
esac
