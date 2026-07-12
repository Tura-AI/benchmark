# Python xsv Port Architecture

## Compatibility boundary

The rebuilt command must match xsv 0.13.0 for the benchmark command set:
`headers`, `count`, `select`, `slice`, `search`, `sort`, `table`, `fmt`,
`stats`, and `frequency`. Observable behavior is the process exit status and
the exact bytes written to stdout and stderr.

## Modules

- `xsv_core.py`: byte-oriented CSV parsing/writing, input/output configuration,
  column-selector parsing, Rust-compatible scalar parsing, and shared errors.
- `xsv_commands.py`: command behavior. Commands consume normalized option
  dictionaries and use only the shared core for CSV I/O.
- `xsv_port.py`: top-level command dispatch, Docopt-compatible option handling,
  help/version output, and process error mapping.
- `.tura/script/differential.py`: black-box compatibility suite that executes
  the official binary and Python port with identical argv, stdin, files, and
  environment, then compares status/stdout/stderr byte for byte.

## Stable invariants

1. CSV fields remain bytes until a command explicitly needs UTF-8 or numeric
   interpretation.
2. A path ending in `.tsv` defaults to a tab delimiter for both reading and
   writing; an explicit delimiter takes precedence.
3. Header mode consumes the first record as names. No-header mode uses the
   first record to resolve column indices but keeps it in the data stream.
4. All CSV-producing commands use the same quoting and record-termination
   rules.
5. The implementation never invokes the official xsv binary. Only the
   differential test harness may invoke it.
6. No third-party Python package is required at build time or runtime.

## Entrypoints

`compile.sh` validates the Python source and creates exactly one highest-priority
entrypoint suitable for the detected host: `executable.cmd` on Windows-like
shells, or a Python-shebang `executable` on Unix-like systems. Repeated builds
remove stale alternatives before recreating the host entrypoint.
