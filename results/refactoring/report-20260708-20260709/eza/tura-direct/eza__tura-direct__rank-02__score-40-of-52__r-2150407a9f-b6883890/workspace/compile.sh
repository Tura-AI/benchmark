#!/usr/bin/env sh
set -eu
chmod +x executable 2>/dev/null || true
python -m py_compile eza_port.py executable
