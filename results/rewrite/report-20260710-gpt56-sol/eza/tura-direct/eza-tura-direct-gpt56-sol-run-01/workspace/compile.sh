#!/usr/bin/env sh
set -eu

# Windows is the benchmark runtime. Keep the first discoverable entrypoint a
# native cmd wrapper, and reject a stale higher-priority extensionless file.
rm -f executable executable.exe
python -m py_compile eza_port.py
[ -f executable.cmd ]
