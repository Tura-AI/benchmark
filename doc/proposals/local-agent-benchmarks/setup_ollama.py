#!/usr/bin/env python3
"""Set up the local Ollama benchmark on Windows or other Python platforms."""

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
VENV_DIR = REPO_ROOT / ".venv"
MODELS = ("qwen2.5:14b", "granite4:tiny-h")


def fail(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def command_path(path: Path) -> str:
    """Quote a path for the current platform's shell."""
    if os.name == "nt":
        return subprocess.list2cmdline([str(path)])
    return shlex.quote(str(path))


def main() -> None:
    if sys.version_info < (3, 10):
        fail("Python 3.10 or newer is required.")

    print(f"Using Python {sys.version.split()[0]}")

    if shutil.which("ollama") is None:
        fail("Ollama is not installed or is not available on PATH.")

    service_check = subprocess.run(
        ["ollama", "list"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    if service_check.returncode != 0:
        fail(
            "Ollama is installed, but its local service is not reachable. "
            "Start Ollama, then rerun this script."
        )

    if not VENV_DIR.is_dir():
        print(f"Creating virtual environment at {VENV_DIR}")
        subprocess.run(
            [sys.executable, "-m", "venv", str(VENV_DIR)], check=True
        )

    executable = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    venv_python = VENV_DIR / executable
    if not venv_python.is_file():
        fail(
            f"{VENV_DIR} exists but does not contain a usable Python executable. "
            "Remove or repair it, then rerun this script."
        )

    print("Installing Python dependencies from requirements.txt")
    subprocess.run(
        [str(venv_python), "-m", "pip", "install", "-r", str(REPO_ROOT / "requirements.txt")],
        check=True,
    )

    for model in MODELS:
        print(f"Pulling Ollama model: {model}")
        subprocess.run(["ollama", "pull", model], check=True)

    src_dir = REPO_ROOT / "src"
    python_command = command_path(venv_python)
    cd_command = (
        f"cd /d {command_path(src_dir)}"
        if os.name == "nt"
        else f"cd {command_path(src_dir)}"
    )

    print("\nSetup complete. The benchmarks were not started.")
    print("Run one of the following evaluations:")
    print(f"\n  {cd_command}")
    print(f"  {python_command} evaluate_mcp.py")
    print(f"  {python_command} evaluate_code.py")
    print(f"  {python_command} -m pytest evaluate.py -s")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        fail(f"Command failed with exit code {exc.returncode}.")
