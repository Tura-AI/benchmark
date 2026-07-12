# Tura Benchmark

Tura Benchmark is the reproducible evaluation repository for long-horizon
coding agents. It contains portable task definitions, agent and runtime
configuration, benchmark runners, validation schemas, and published result
artifacts for debug, rewrite, and design evaluations.

## Requirements

- Node.js 20 or newer
- Python 3.11 or newer
- Git
- Docker and the selected agent CLI for live DeepSWE runs

Provider authentication is handled by the selected agent CLI and is not stored
in this repository.

## Install and check

```sh
git clone https://github.com/Tura-AI/benchmark.git
cd benchmark
npm run setup
npm run doctor
node scripts/benchmark.mjs list
node scripts/benchmark.mjs validate
```

`npm run setup` checks the required Node.js and Python versions, installs the
locked Node dependencies, creates a project-local `.venv`, and installs the
pinned Python validation dependencies. It is safe to run again. It does not
install or authenticate Docker, Git, or agent CLIs because those are
system-level tools with platform-specific installation and credentials.

This repository has no long-running application server; the benchmark CLI is
the entry point. Verify the installation and run the full local quality suite:

```sh
npm run doctor
npm run check
```

## Reproduce a benchmark

First inspect the resolved plan. This does not launch an agent:

```sh
node scripts/benchmark.mjs plan \
  --task source-port-python-default-eza \
  --agents balanced,direct \
  --replicates 2
```

After checking the model, agent, paths, concurrency, and provider cost, run the
same matrix explicitly:

```sh
node scripts/benchmark.mjs run \
  --task source-port-python-default-eza \
  --agents balanced,direct \
  --replicates 2
```

Use `node scripts/benchmark.mjs list` for available task and agent IDs, and
`node scripts/benchmark.mjs help` for all options.

### Re-run the DeepSWE v1.1 subset

Create the default cost-free plan:

```sh
npm run benchmark:deep-swe
```

Launch the default live Tura Balanced run only after reviewing that plan:

```sh
npm run benchmark:deep-swe:run
```

Live DeepSWE execution requires Docker, Git, Python 3.11+, the selected agent
CLI on `PATH`, and valid provider authentication. The first run checks out the
pinned DeepSWE revision under `raw/_cache/deep-swe`; later runs reuse that
checkout and Docker's image cache. Local run data is written under `raw/`.

Before a live run, check Docker and the exact agents in the intended matrix:

```sh
node scripts/doctor.mjs --benchmark --agents=balanced,direct
```

This command checks local executables and the Docker daemon only. It does not
verify provider credentials, pull images, launch agents, or consume provider
quota.

## Documentation

- [Architecture and repository contracts](doc/architecture.md)
- [Benchmark methodology](doc/benchmark-methodology.md)
- [Current test-set evidence record](doc/current-test-set-record.md)

Published, reproducible artifacts live under `results/`. Local logs, caches,
downloaded repositories, workspaces, and provider state belong under the
ignored `raw/` and `.tura/` directories.

## License

[MIT](LICENSE)
