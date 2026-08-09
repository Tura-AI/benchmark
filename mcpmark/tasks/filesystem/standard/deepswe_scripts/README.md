# DeepSWE-style scripts task pack

This category contains 20 original repository-level engineering tasks.
It follows the public DeepSWE methodology but does not copy gated benchmark
instances, hidden tests, or reference solutions. The fixed RelayKit starting
repository is stored in `tasks/filesystem/fixtures/deepswe_scripts` and installed by
the filesystem state manager before a run. Every task directory contains its
own complete `verify.py`; verification does not import a shared test runner.

Regenerate the pack with:

```bash
python tasks/filesystem/scripts/generate_deepswe_tasks.py --force
```
