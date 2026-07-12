# zip-password-finder source-port rebuild

Schema: `tura.benchmark.task.v1`

This directory contains the normalized benchmark task declaration and harness score item contract.

- `task.json`: task identity, source code location, target language, and harness binding.
- `harness.json`: stable score item ids, names, descriptions, harness code location, and source location.
- Harness reports for individual runs live beside each run at `metadata/contracts/harness-report.json`.

Score items are stable within this archived benchmark dataset. If an archived run does not expose assertion text for a failure, the per-run report keeps the assertion field empty rather than inventing one.
