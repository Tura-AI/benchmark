#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

PYTHON_CMD=()
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
    PYTHON_CMD=(python3)
elif command -v python >/dev/null 2>&1 && python -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
    PYTHON_CMD=(python)
elif command -v py >/dev/null 2>&1 && py -3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
    PYTHON_CMD=(py -3)
else
    echo "Error: Python 3.10 or newer is required and was not found on PATH." >&2
    exit 1
fi

echo "Using $("${PYTHON_CMD[@]}" --version 2>&1)"

if ! command -v ollama >/dev/null 2>&1; then
    echo "Error: Ollama is not installed or is not available on PATH." >&2
    exit 1
fi

if ! ollama list >/dev/null 2>&1; then
    echo "Error: Ollama is installed, but its local service is not reachable." >&2
    echo "Start Ollama in another terminal with 'ollama serve' (or start the Ollama desktop app), then rerun this script." >&2
    exit 1
fi

if [[ ! -d "$REPO_ROOT/.venv" ]]; then
    echo "Creating virtual environment at $REPO_ROOT/.venv"
    "${PYTHON_CMD[@]}" -m venv "$REPO_ROOT/.venv"
fi

if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    VENV_PYTHON="$REPO_ROOT/.venv/bin/python"
elif [[ -x "$REPO_ROOT/.venv/Scripts/python.exe" ]]; then
    VENV_PYTHON="$REPO_ROOT/.venv/Scripts/python.exe"
else
    echo "Error: .venv exists but does not contain a usable Python executable." >&2
    echo "Remove or repair .venv, then rerun this script." >&2
    exit 1
fi

echo "Installing Python dependencies from requirements.txt"
"$VENV_PYTHON" -m pip install -r "$REPO_ROOT/requirements.txt"

MODELS=("qwen2.5:14b" "granite4:tiny-h")
for model in "${MODELS[@]}"; do
    echo "Pulling Ollama model: $model"
    ollama pull "$model"
done

echo
echo "Setup complete. The benchmarks were not started."
echo "Run the following commands exactly as shown:"
echo
echo "Standard MCP evaluation:"
printf '  cd %q\n' "$REPO_ROOT/src"
printf '  %q evaluate_mcp.py\n' "$VENV_PYTHON"
echo
echo "Code-mode MCP evaluation:"
printf '  cd %q\n' "$REPO_ROOT/src"
printf '  %q evaluate_code.py\n' "$VENV_PYTHON"
echo
echo "Hierarchical evaluation:"
printf '  cd %q\n' "$REPO_ROOT/src"
printf '  %q -m pytest evaluate.py -s\n' "$VENV_PYTHON"
