#!/usr/bin/env sh
set -eu
case "$(uname -s 2>/dev/null || printf Windows_NT)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    rm -f executable
    cat > executable.cmd <<'EOF'
@echo off
python "%~dp0zip_password_finder.py" %*
EOF
    ;;
  *)
    rm -f executable.cmd
    chmod +x zip_password_finder.py
    cat > executable <<'EOF'
#!/usr/bin/env sh
exec python3 "$(dirname "$0")/zip_password_finder.py" "$@"
EOF
    chmod +x executable
    ;;
esac
