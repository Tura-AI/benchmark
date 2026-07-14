#!/usr/bin/env sh
set -eu

# Remove every evaluator-recognized entrypoint before creating the one native
# to this host.  This keeps repeated builds from exposing a stale wrapper first.
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar

case "$(uname -s 2>/dev/null || printf unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    printf '%s\r\n' '@echo off' 'python "%~dp0nushell_port.py" %*' > executable.cmd
    ;;
  *)
    cp nushell_port.py executable
    chmod +x executable
    ;;
esac
