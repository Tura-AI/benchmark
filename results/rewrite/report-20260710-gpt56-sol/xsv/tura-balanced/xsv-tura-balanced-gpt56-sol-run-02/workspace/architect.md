# xsv Python Port Architecture

## Compatibility boundary

The rebuilt CLI must match xsv 0.13.0 for `headers`, `count`, `select`,
`slice`, `search`, `sort`, `table`, `fmt`, `stats`, and `frequency`. Observable
behavior is the process exit code plus exact stdout, stderr, and requested
output-file bytes.

## Modules and data flow

`xsv_port.py` owns the command dispatcher and command implementations. Shared
byte-oriented CSV reader/writer code preserves arbitrary field bytes, RFC CSV
quoting, delimiters, embedded records, BOM handling, and fixed record widths.
A selector parser resolves the reference selector grammar once against the
first record and supplies indices to all selector-aware commands.

Input is read from a named file or stdin and output is written to a named file
or stdout. Index sidecars are an optimization only; these commands can produce
the same logical result by sequentially reading the CSV file.

Statistics use per-column accumulators mirroring the Rust type promotion,
population variance, frequency, min/max, sum, median, and optional output
columns. Formatting helpers emit Rust-compatible integer and floating-point
text.

## Compatibility validation

`.tura/script/differential.py` invokes the official binary and rebuilt CLI in
isolated directories with identical argv, stdin, and fixtures. It compares
exit status, stdout, stderr, and output files byte-for-byte. Its cases cover
every requested command, option families, stdin/file paths, selectors, CSV
quoting, empty values, Unicode, errors, and numerical behavior.

The final gate is: Python syntax check, idempotent `compile.sh`, direct
entrypoint smoke check, source-derived command checks, and a fully passing
differential verifier.

The Rust integration harness cannot be pointed at a foreign executable: its
`Workdir::xsv_bin` method hard-codes Cargo's `target/.../xsv` path. Therefore,
the applicable assertions for the ten-command scope are represented as
black-box differential cases rather than altering the reference test source.
