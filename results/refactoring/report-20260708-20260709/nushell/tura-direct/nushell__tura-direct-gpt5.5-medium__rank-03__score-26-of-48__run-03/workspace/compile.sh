#!/usr/bin/env sh
set -eu
if [ -f executable.cmd ]; then
  exit 0
fi
if [ -f executable ]; then
  chmod +x executable || true
  exit 0
fi
echo "missing executable.cmd" >&2
exit 1
