You are in a benchmark workspace containing a Rust reference application at ./rust-reference and an official release binary path recorded in ./REFERENCE_BINARY.txt.

Goal:
Create a Python implementation that is a 1:1 functional port of the reference application for this benchmark. For the same input, the official binary and your rebuilt version must produce exactly the same observable result: exit status, stdout, and stderr.

Reference:
- Project: eza
- Repository: https://github.com/eza-community/eza.git
- Release/tag: v0.23.3
- Commit: 05d20d11c488b2ad3f0d63ac0b529281cc1c16ef
- Local source copy: ./rust-reference
- Official binary: read ./REFERENCE_BINARY.txt

Hard constraints:
- Do not use Docker.
- Do not search the internet.
- Do not look for, copy, adapt, vendor, install, or import an existing Python implementation, clone, wrapper, compatibility layer, or package for this application.
- Use ./rust-reference and the official binary as the only functional sources of truth.
- Implement in Python.
- Do not shell out to the official binary from your implementation.
- Do not install packages that already implement this application or its command suite.
- The root deliverable must include ./executable. The harness will run it as: python ./executable ...
- Also include ./compile.sh. It may be tiny, but it must leave ./executable present and ready to run.

Equivalence requirements:
- For every evaluated invocation, running the official binary and running python ./executable with the same argv, stdin, files, and environment must produce the same exit status, stdout, and stderr.
- If the official binary prints nothing, your program must print nothing.
- If the official binary writes to stderr, your program must write to stderr.

Do not ask the user questions. Infer from source and official CLI behavior.