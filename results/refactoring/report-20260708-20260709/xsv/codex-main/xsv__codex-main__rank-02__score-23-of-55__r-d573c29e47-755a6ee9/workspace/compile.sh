#!/usr/bin/env sh
set -eu

case "$(uname -s 2>/dev/null || echo Windows_NT)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT*)
    cat > executable.cmd <<'EOF'
@echo off
python "%~dp0xsv_py.py" %*
EOF
    ;;
  *)
    cat > executable <<'EOF'
#!/usr/bin/env sh
exec python3 "$(dirname "$0")/xsv_py.py" "$@"
EOF
    chmod +x executable
    ;;
esac
