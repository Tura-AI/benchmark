#!/usr/bin/env sh
set -eu

# The evaluator checks ./executable first. Keep it as valid Python source,
# not a shell wrapper, so it is directly runnable on both Windows and Unix.
cat > executable <<'PY'
#!/usr/bin/env python3
from nushell_port import main
import sys

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
PY
chmod +x executable 2>/dev/null || true

if [ "$(uname -s 2>/dev/null || echo unknown)" != "Linux" ] && [ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]; then
  cat > executable.cmd <<'CMD'
@echo off
python "%~dp0nushell_port.py" %*
CMD
fi
