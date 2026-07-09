#!/usr/bin/env sh
set -eu

cat > executable <<'PY'
#!/usr/bin/env python3
import sys
from nushell_port import run

if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
PY

chmod +x executable 2>/dev/null || true
rm -f executable.exe executable.cmd executable.bat executable.js executable.jar executable.py
python -m py_compile nushell_port.py executable
