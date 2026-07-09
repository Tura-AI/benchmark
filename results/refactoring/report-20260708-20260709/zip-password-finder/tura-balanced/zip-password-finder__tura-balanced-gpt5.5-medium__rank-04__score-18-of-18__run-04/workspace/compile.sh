#!/usr/bin/env sh
set -eu

# The evaluator discovers ./executable first. It is valid Python source and can
# be run as `python ./executable <args>` on every supported platform.
[ -f executable ]
if command -v chmod >/dev/null 2>&1; then
  chmod +x executable || true
fi
