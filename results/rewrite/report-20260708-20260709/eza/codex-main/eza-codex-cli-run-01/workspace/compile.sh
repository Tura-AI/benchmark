#!/usr/bin/env sh
set -eu
chmod +x ./executable 2>/dev/null || true
[ -f ./executable ]
