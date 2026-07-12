#!/usr/bin/env sh
set -eu
chmod +x executable
python -m py_compile xsv_port.py executable
