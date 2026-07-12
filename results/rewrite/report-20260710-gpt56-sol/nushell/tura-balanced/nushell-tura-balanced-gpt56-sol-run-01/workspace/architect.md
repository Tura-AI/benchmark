# Python Port Architecture

## Compatibility boundary

The evaluator launches the root entrypoint with the same arguments, standard
input, working directory, files, and environment as Nushell 0.106.1.  The port
therefore treats `(exit status, stdout bytes, stderr bytes, filesystem effects)`
as its public API.

## Design

`nushell_port.py` contains four layers:

1. A lexer and recursive-descent parser for the benchmark's Nushell expression
   grammar. It produces typed Python values rather than rewriting source text.
2. An evaluator with lexical variables, blocks, operators, statement lists,
   and typed pipelines.
3. Built-in commands for the requested table, JSON, CSV, string, math, and
   filesystem behavior areas.
4. Raw-text and table renderers plus CLI/error handling. Raw command output is
   kept distinct from ordinary strings so final newline behavior matches Nu.

No implementation path invokes the reference executable. The reference path
is used only by `compat_verify.py`, an out-of-process development verifier.

## Compatibility validation

`compat_verify.py` runs a manifest of representative commands in isolated
temporary directories, captures bytes from both programs, and compares status,
stdout, stderr, and resulting files. Cases cover literals/operators, nested
values, pipelines, JSON, CSV, strings, math, variables, and filesystem I/O.
Adding a newly discovered behavior requires adding a differential case before
changing the implementation.
