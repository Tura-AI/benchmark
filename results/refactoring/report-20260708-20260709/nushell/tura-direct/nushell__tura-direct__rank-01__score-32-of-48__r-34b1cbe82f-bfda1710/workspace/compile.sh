#!/usr/bin/env sh
set -eu

# The evaluator checks ./executable before platform-specific wrappers.
# Keep it as valid Python source, not a POSIX shell wrapper.
if [ -f executable ]; then
  rm -f executable
fi
cp nushell_port.py executable

# Windows convenience wrapper, lower priority than ./executable.
cat > executable.cmd <<'EOF'
@echo off
python "%~dp0nushell_port.py" %*
EOF

python -m py_compile nushell_port.py
