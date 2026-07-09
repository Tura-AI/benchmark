#!/usr/bin/env sh
set -eu

cat > executable <<'PY'
#!/usr/bin/env python3
import xsv_port

if __name__ == "__main__":
    raise SystemExit(xsv_port.main())
PY

if [ -n "${COMSPEC:-}" ]; then
  cat > executable.cmd <<'CMD'
@echo off
python "%~dp0xsv_port.py" %*
CMD
fi

chmod +x executable 2>/dev/null || true
