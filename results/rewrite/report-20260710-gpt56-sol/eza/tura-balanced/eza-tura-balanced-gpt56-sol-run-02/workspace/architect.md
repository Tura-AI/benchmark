# eza Python Port Architecture

## Compatibility boundary

The root command is a Python implementation of the scoped behavior of eza
v0.23.3.  For equal argv, stdin, environment, and filesystem state it must
match the official executable's exit status and raw stdout/stderr bytes.
The implementation must never execute the reference binary or another listing
command.

The benchmark scope is directory and explicit-path listing, long view, tree
and recursive view, sorting/filtering, and hidden files, with colors and icons
disabled.  Parser failures and filesystem failures in those paths are part of
the observable contract.

## Modules

- `eza_port.py`: parser, filesystem model, filters/sorts, renderers, and CLI.
- `executable`: directly runnable Python entrypoint importing `eza_port.main`.
- `compile.sh`: idempotent syntax/build check and entrypoint cleanup.
- `.tura/script/differential.py`: standalone black-box compatibility verifier.

Keeping the port in one implementation module avoids pretending that Python
has Rust's internal type boundaries.  Internal dataclasses correspond only to
stable concepts needed in multiple phases: parsed options, file entries, and
tree rows.

## Processing pipeline

1. Parse eza's long, short, combined-short, attached-value, and `--` syntax.
2. Apply rightmost-option precedence where eza does and validate scoped values.
3. Resolve default/stdin/explicit paths and classify input files/directories.
4. Enumerate directories with Windows hidden-name and hidden-attribute rules.
5. Filter, stable-sort, and optionally recurse.
6. Render names, aligned long rows, recursive sections, or Unicode tree rows.
7. Write stdout/stderr and return eza-compatible status codes.

## Compatibility invariants

- stdout and stderr are never merged.
- Successful empty listings emit no bytes.
- Every emitted record is written as raw UTF-8 bytes with LF terminators,
  matching the Windows reference without Python's CRLF text translation.
- Directory enumeration order matters only for `--sort=none`; other sorts use
  eza's stable natural-order semantics and grouping pass.
- Explicit path spelling is preserved where eza displays it.
- Table widths are computed over the same rendering block as the reference.
- Tree depth limits count the displayed root as depth zero.
- Colors and icons remain absent when explicitly disabled.

## Verification strategy

The differential verifier creates a deterministic temporary hierarchy and
runs an invocation matrix against both commands.  It compares return code,
stdout bytes, and stderr bytes independently and prints only concise mismatch
diagnostics.  Dynamic long-view fields are tested both through suppression
flags and direct byte comparison on the same files.  Syntax checks, wrapper
checks, the full differential matrix, and focused parser/error probes are all
required before completion.
