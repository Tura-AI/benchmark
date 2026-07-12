# Python port architecture

The observable contract is the `zip-password-finder` 0.11.1 command line: argv
validation, exit status, stdout/stderr, candidate ordering, archive-member
selection, and password results.  `main.py` owns that complete boundary without
calling the reference binary or an external archive utility.

The implementation has four deliberately small layers:

1. `parse_args` reproduces clap's accepted options and application validation.
2. Charset, dictionary, and mask iterators reproduce the Rust candidate order.
3. `ZipTarget` parses ZIP metadata, selects the first encrypted member when
   necessary, and validates ZipCrypto or WinZip AES passwords.
4. `run` writes only the diagnostics and final result exposed by the Rust CLI.

`tests/differential.py` compares stable observable output with the official
binary. Dynamic elapsed durations are validated by shape and normalized only
for comparison; all other output and status are compared exactly.
