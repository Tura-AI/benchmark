# Python port architecture

## Compatibility boundary

`zip_password_finder_port.py` is a standalone Python implementation of the
`zip-password-finder` 0.11.1 command. It owns argument parsing, validation,
candidate generation, ZIP parsing, password verification, and stdout/stderr
formatting. It never starts or imports the reference executable.

The observable compatibility boundary is process status plus raw stdout and
stderr. Clap's user-facing validation is reproduced by the CLI parser. Runtime
domain errors retain the Rust `FinderError` prefixes.

## Data flow

1. Parse the single-command CLI and apply validations in Rust source order.
2. Parse central-directory and local-file ZIP metadata and select the requested
   encrypted member, falling back to the first encrypted member when needed.
3. Lazily produce byte candidates from a dictionary, an odometer-style preset
   charset generator, or a mixed-radix mask generator.
4. Verify candidates directly: traditional ZipCrypto decrypts and validates
   extracted data; WinZip AES uses PBKDF2-HMAC-SHA1, AES-CTR, HMAC-SHA1, and
   decompression/size checks.
5. Emit the same final result lines and error stream as the Rust command.

Workers affect candidate partitioning in Rust but not the successful result for
well-formed inputs. Python evaluates the same complete ordered candidate space
in one process while validating `--workers` exactly; this avoids nondeterministic
thread races without changing exhaustive search semantics.

## Entrypoints

`compile.sh` is idempotent. On Windows it creates only `executable.cmd`; on
Unix-like systems it creates `executable` as directly runnable Python source.
The implementation itself remains in `zip_password_finder_port.py`.

## Verification

`test_port.py` covers parser helpers, candidate ordering, both encryption
families, and end-to-end fixtures. `differential_verify.py` compares the port
with the official binary over generated validation and fixture cases. Elapsed
time is checked by syntax rather than equality because independent executions
necessarily report different measured durations.
