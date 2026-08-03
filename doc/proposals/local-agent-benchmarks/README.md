# Local Agent Benchmarks Task Proposal

This directory proposes a repository-improvement benchmark task based on
[`dkpgde/local-agent-benchmarks`](https://github.com/dkpgde/local-agent-benchmarks).

The source repository compares standard MCP tool calling, code-mode MCP, and a
hierarchical LangGraph supervisor/worker approach using local Ollama models. The
proposed task asks a coding agent to turn the exploratory project into a more
reproducible, configurable, and consistent benchmark project.

## Included files

- [`TASK.md`](TASK.md) defines the proposed task, acceptance criteria,
  preservation requirements, and out-of-scope work.
- [`REPRODUCTION.md`](REPRODUCTION.md) documents the current benchmark setup,
  execution commands, result behavior, and known limitations.
- [`setup_ollama.sh`](setup_ollama.sh) prepares the source repository on Linux,
  macOS, or WSL.
- [`setup_ollama.py`](setup_ollama.py) provides the corresponding setup workflow
  for Windows and other Python environments.

## Setup-helper context

The setup helpers are reference artifacts from the source repository. They
expect to be located and executed at the root of a
`local-agent-benchmarks` checkout, alongside its `requirements.txt`, `src/`,
and `test/` paths.
