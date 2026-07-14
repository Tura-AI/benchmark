#!/usr/bin/env sh
set -eu

# The benchmark runs on Windows and discovers .cmd after the extensionless slot.
# Remove higher-priority stale entrypoints, then create an idempotent launcher.
rm -f executable executable.exe executable.cmd executable.bat executable.js executable.py executable.jar
cp launcher.cmd executable.cmd
