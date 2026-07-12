# eza Python Port Architecture

## Objective

Reproduce the observable behavior of eza v0.23.3 for the benchmark scope:
directory listing, long view, tree view, sorting, hidden entries, with colors and
icons disabled. For identical argv, stdin, filesystem, and environment, the
Python command must match the reference process's exit status, stdout bytes,
and stderr bytes.

## Compatibility boundary

The port is organized around the same stable behavioral stages as the Rust
application without copying its internal type structure:

1. `parse_args` recognizes eza flags, short-option clusters, option values,
   positional paths, and parser failures.
2. The process layer distinguishes explicit files from directories whose
   children should be listed, handles missing paths, and records metadata.
3. `filter_entries` applies hidden-entry, type, symlink, and ignore rules.
4. `sort_entries` applies eza's stable primary sort, reverse ordering, and
   directory grouping.
5. View renderers produce lines, long tables, recursive blocks, or trees.
6. The process layer writes only to the correct stream and returns eza's exit
   statuses (`0` success, `2` input-path error, `3` option error).

The implementation may use only Python's standard library. It must never call
the reference executable or delegate listing behavior to another CLI.

## Entrypoint contract

`compile.sh` is idempotent. It validates the Python source, removes stale
alternative entrypoints, then creates the platform-native first entrypoint: a
shebang Python `executable` on Unix-like systems or `executable.cmd` on Windows.

## Backward-compatibility framework

`.tura/script/differential.py` creates a deterministic temporary filesystem,
runs a generated invocation matrix against both the official binary and the
Python port, and compares status, stdout, and stderr as bytes. Cases cover each
requested behavior independently and in combinations. It also executes every
local `tests/cmd` case that does not require icons, plus all generated power-test
argument combinations applicable to the benchmark scope. Any mismatch prints a
compact unified diff and the exact argv. The verifier is independent of the
implementation and is the primary compatibility oracle.

## Deliberate scope choices

Colors and icons are parsed but disabled in the benchmark cases. Git status,
extended attributes, Unix-only owner/group semantics, and platform-specific
device metadata are outside the stated behavior area; parser compatibility for
harmless adjacent flags is still retained where practical. No output fixture
from the Rust test suite is treated as stronger evidence than a live
differential result on the current host.
