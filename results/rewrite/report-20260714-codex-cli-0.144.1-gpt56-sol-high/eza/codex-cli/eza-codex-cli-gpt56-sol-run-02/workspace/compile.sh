#!/usr/bin/env sh
set -eu

# The evaluator prefers ./executable over Windows launchers.  Never leave a
# POSIX wrapper there on this Windows target: it would be selected first and
# invoked with the wrong runtime.
rm -f executable executable.exe executable.bat executable.js executable.py executable.jar
cp executable.cmd.in executable.cmd
