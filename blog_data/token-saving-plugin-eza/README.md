# Token-saving plugin eza runs

This directory is the public, credential-free evidence package for the Ponytail/RTK/Caveman comparison cited by the token-saving-plugins article.

All formal runs used the `source-port-python-default-eza` task, `gpt-5.6-sol`, High reasoning, and Codex CLI 0.144.1. The task asks the agent to rewrite the Rust eza repository as a Python implementation, then scores behavior with 52 harness assertions. Each arm contains two runs. The no-plugin pair was previously published with the same model, reasoning level, CLI, and task.

## Group means

| Arm | n | Harness score | Total tokens | Modeled cost | Rounds | Duration | Cached token share |
| --- | -: | ------------: | -----------: | -----------: | -----: | -------: | -----------------: |
| no-plugin | 2 | 78.85% | 6,660,286 | $5.281946 | 62.5 | 895.3s | 96.78% |
| ponytail | 2 | 80.77% | 6,156,827 | $4.813366 | 56.5 | 1016.2s | 96.74% |
| rtk | 2 | 76.92% | 7,539,176 | $5.661141 | 90.0 | 1259.5s | 97.27% |
| caveman | 2 | 86.54% | 6,391,824 | $5.076112 | 57.0 | 915.8s | 96.52% |

## Relative to the no-plugin High baseline

| Arm | Score | Total tokens | Modeled cost | Rounds | Duration |
| --- | ----: | -----------: | -----------: | -----: | -------: |
| ponytail | +1.92pp | -7.56% | -8.87% | -9.60% | +13.51% |
| rtk | -1.92pp | +13.20% | +7.18% | +44.00% | +40.69% |
| caveman | +7.69pp | -4.03% | -3.90% | -8.80% | +2.29% |

## Variation between the two replicates

Range / mean measures the gap between the two runs relative to their mean.

| Arm | Token range / mean | Cost range / mean | Round range / mean |
| --- | -----------------: | ----------------: | -----------------: |
| no-plugin | 53.02% | 43.25% | 40.00% |
| ponytail | 57.36% | 51.69% | 47.79% |
| rtk | 39.75% | 30.78% | 26.67% |
| caveman | 2.92% | 1.82% | 17.54% |

Both Ponytail runs use full hook-and-skill activation. The matched RTK runs use the same plugin-run indices, r2/r3. Ponytail r1 was excluded because it was skill-only; RTK r1 was excluded by the same replicate-index rule rather than by its outcome. Both Caveman runs use 20 skills in separate isolated Codex homes plus the exact upstream primary skill body in global AGENTS.md, keeping the task prompt unchanged while guaranteeing activation. Caveman's Codex ChatGPT-login proxy path is metering-only, so this arm tests the skill package, not proxy input compression. The original Ponytail/RTK mean cost differences remain smaller than their within-arm variation; Caveman's two costs are closer together, but n=2 is still too small for an effect estimate. The samples are small, so these are descriptive differences, not significance or general-performance claims.

## Files

- `runs.json`: sanitized per-run observations for six plugin runs and two matched baselines.
- `summary.json`: deterministic group means and baseline deltas generated from `runs.json`.
- `methodology.json`: versions, pricing, isolation conditions, activation caveats, and provenance.
- `round-activation-audit.jsonl`: one activation verdict per internal plugin-run round.

Recompute the report without launching an agent:

```sh
npm run analysis:plugin-ab
```

The outer source-port suite records `ok: false` whenever any harness assertion fails. That is a score outcome, not a crashed agent run: all eight Codex processes exited 0 and produced complete usage and evaluator data.
