# Nushell 0.106.1 Python Port Architecture

## Compatibility boundary

The evaluator invokes the root entrypoint with Nushell command-line arguments.  The
benchmark scope is non-interactive `nu -c` evaluation of expressions, pipelines,
tables, JSON, CSV, strings, math, and small filesystem operations.  Observable
behavior is the process exit status and the exact bytes written to stdout/stderr.

The Rust executable is used only by the development verifier.  Production code
must never invoke it.

## Modules

`nushell_port.py` contains five deliberately small layers:

1. CLI parsing for the benchmark-relevant Nushell flags.
2. A lexer and Pratt parser for literals, variables, collections, ranges,
   operators, blocks, statements, and pipelines.
3. Runtime values and lexical environments.
4. Built-in pipeline commands for structured data, strings, math, conversion,
   and filesystem snippets.
5. Nushell-compatible terminal rendering and diagnostics.

`verify_port.py` is the backward-compatibility harness.  It invokes the official
binary and rebuilt entrypoint independently, captures raw output, and compares
status/stdout/stderr.  Filesystem cases run in disposable directories.

`compile.sh` creates only an OS-appropriate, directly runnable entrypoint.  On
Windows that is `executable.cmd`; on Unix it is Python source named `executable`.

## Stable invariants

- Values stay typed through pipelines; formatting occurs only at the terminal or
  in explicit format commands.
- Pipeline commands receive one value and return one value or raise a structured
  shell error.
- No fallback can execute the reference binary.
- Text and files use UTF-8 unless the source command explicitly exposes bytes.
- Command errors are distinct from parse errors and preserve nonzero status.
- The implementation has no third-party runtime dependencies.

## Compatibility validation

The verifier groups cases by language expressions, tables, JSON/CSV, strings,
math, filesystem behavior, stdin, CLI flags, and failures.  Every case compares
the complete observable triple.  Syntax compilation, idempotent wrapper builds,
the full differential corpus, and direct smoke tests form the completion gate.
