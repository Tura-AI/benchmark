# Reproducing the benchmark

This repository compares standard MCP tool calling, code-mode MCP, and a hierarchical (LangGraph tool calls) supervisor/worker graph over the 22 cases in `test/test_set.json`. All evaluation commands must be run with `src/` as the working directory because the programs use paths relative to the current directory.

## Prerequisites

- Bash to run `setup_ollama.sh` on Linux, macOS, or WSL. Windows can use `setup_ollama.py` without Bash.
- Python 3.10 or newer.
- [Ollama](https://docs.ollama.com/quickstart) installed, on `PATH`, and running locally.
- Network access during setup to install Python packages and download the Ollama models.
- Enough local disk space and memory for `qwen2.5:14B` and `granite4:tiny-h` (as used in the runs). The exact resource requirements depend on the Ollama build, model quantization, and hardware.

The repository has no lockfile and most entries in `requirements.txt` use minimum or unpinned versions. A future installation may therefore resolve different dependency versions from the ones used for the archived results.

## Start Ollama

On Linux, start the service in a separate terminal and leave it running (or start its configured system service):

```bash
ollama serve
```

On [macOS](https://docs.ollama.com/macos) or [Windows](https://docs.ollama.com/windows), starting the Ollama desktop application normally starts the local service. The native Windows application runs in the background after installation. `ollama serve` may also be used with a CLI/service installation. Confirm that the CLI can reach the service:

```bash
ollama list
```

The LangChain clients use Ollama's default local endpoint.

## Install dependencies and models

On Linux, macOS, or WSL, run from the repository root:

```bash
bash setup_ollama.sh
```

On Windows, run from CMD in the repository root:

```bat
python setup_ollama.py
```

Both setup scripts perform the same steps:

1. verifies Python 3.10+;
2. verifies that the `ollama` command exists and that `ollama list` can reach the service;
3. creates `.venv` if it is absent;
4. installs `requirements.txt` into that environment;
5. pulls `qwen2.5:14b` and `granite4:tiny-h`;
6. prints the exact commands for all three evaluations without running them.

## Run the evaluations

The required working directory is `src/`.

For a POSIX virtual environment (Linux, macOS, or WSL):

```bash
cd /path/to/repository/src

# Standard MCP
../.venv/bin/python evaluate_mcp.py

# Code-mode MCP
../.venv/bin/python evaluate_code.py

# Hierarchical supervisor/workers
../.venv/bin/python -m pytest evaluate.py -s
```

On Windows, run the evaluations from CMD:

```bat
cd /d C:\path\to\repository\src
..\.venv\Scripts\python.exe evaluate_mcp.py
..\.venv\Scripts\python.exe evaluate_code.py
..\.venv\Scripts\python.exe -m pytest evaluate.py -s
```

Run one command at a time. The commands are listed together for compactness; each starts a complete 22-case evaluation.

Code mode can restart at a question ID. For example, this keeps existing records with IDs below 10 and reruns IDs 10 through 22:

```bash
cd /path/to/repository/src
../.venv/bin/python evaluate_code.py 10
```

## Hard-coded models and paths

| Source file | Hard-coded setting | Runtime effect |
|---|---|---|
| `src/mcp_client.py` | `MODEL_NAME = "qwen2.5:14B"` | Selects the model actually used by both standard MCP and code-mode MCP. It also fixes `SERVER_SCRIPT = "mcp_server.py"`. |
| `src/evaluate_mcp.py` | `MODEL_NAME = "qwen2.5:14B"`; `ANSWERS_FILE = "../test/answers_mcp_qwen.json"` | The model constant is only printed as a label; changing it does **not** change the model in `mcp_client.py`. The answer path is the standard MCP result file. |
| `src/evaluate_code.py` | `MODEL_NAME = "qwen2.5:14B"`; `ANSWERS_FILE = "../test/answers_code_qwen.json"` | The model constant is only printed as a label; changing it does **not** change the model in `mcp_client.py`. The answer path is the code-mode result file. |
| `src/agent_graph.py` | `MODEL_NAME = "granite4:tiny-h"` | Selects the model actually used by the hierarchical supervisor and both workers. |
| `src/benchmark.py` | `MODEL_NAME = "granite4:tiny-h"`; tokenize URL | Chooses the model used for hierarchical token counting and fixes the tokenize endpoint. Keep it aligned with `agent_graph.py`. |
| `src/evaluate.py` | `ANSWERS_FILE = "../test/answers_orchestration.json"` | Selects the hierarchical result file. |
| `src/average_tokens.py` | `DATA_FILE = "../test/answers_code_granite.json"` | Selects an existing result file for the optional average-token helper; it does not run an evaluation or write results. |

All three evaluators also read `../test/test_set.json`. To switch either MCP evaluation to another model, change `src/mcp_client.py` as well as the evaluator's label and output filename. To switch the hierarchical model, keep `src/agent_graph.py` and `src/benchmark.py` aligned and choose a new output filename in `src/evaluate.py`.

## Results and overwrite behavior

Results are written under `test/`:

- Standard MCP: `test/answers_mcp_qwen.json`
- Code-mode MCP: `test/answers_code_qwen.json`
- Hierarchical: `test/answers_orchestration.json`

These paths already contain archived results in the current repository.

- Standard MCP deletes `answers_mcp_qwen.json` at startup, then recreates it after the first completed case and rewrites it after every subsequent case.
- Hierarchical evaluation deletes `answers_orchestration.json` through a session-scoped pytest fixture, then rewrites it after every case.
- Code mode loads `answers_code_qwen.json`. With no starting ID, the default start ID is 1, so all existing records are discarded in memory and the file is replaced when the first case is logged. With a starting ID such as `10`, records with IDs below 10 are retained and later records are replaced as IDs 10-22 are rerun.

Copy or rename any archived result file before running its evaluator if it must be preserved. The scripts do not create automatic backups.

`src/benchmark.py` is a separate timing-only hierarchical runner. It prints to the terminal and does not write a result file; the documented hierarchical evaluation uses `pytest` and `src/evaluate.py` instead.

## Timeouts and limitations

- Code mode has a 300-second timeout **per case**. A full 22-case run can therefore take a long time when several cases time out.
- Standard MCP has no explicit per-case timeout.
- Hierarchical evaluation has no explicit wall-clock timeout. The LangGraph invocation uses a recursion limit of 20, which limits graph steps rather than elapsed time.
- Model downloads and inference time vary substantially by hardware and Ollama configuration.
- MCP model context is hard-coded to 4,096 tokens in `src/mcp_client.py`; the hierarchical model context is 10,240 tokens in `src/agent_graph.py`.
- Pass/fail uses a case-insensitive expected-substring check. It is not a semantic judge and can reject a valid paraphrase or accept a misleading response containing the expected text.
- Code mode executes model-generated Python through `exec`. It is not an operating-system security sandbox and should only be run in a disposable, trusted local environment.
- Token usage depends on LangChain/Ollama metadata. Standard and code modes may report zero when usage metadata is absent.
- Evaluation failures are recorded in JSON, but the hierarchical pytest command also exits nonzero when any case fails. A nonzero pytest exit does not necessarily mean the reproduction process itself crashed.
