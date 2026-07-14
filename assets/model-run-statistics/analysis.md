# Agent-group round, token, success, and cost analysis

## Scope and grain

- Source: run contracts under `results/debug` and `results/rewrite`.
- Source grain: 270 runs across 25 tasks.
- Analysis grain after explicit exclusions: 267 runs across 25 tasks.
- Exclusions: 2 Tura Balanced sparse-tail runs above 90 rounds (113 and 242), plus 1 zero-token usage-unavailable run that did not execute.
- Grouping: all tasks, model versions, and effort configurations are pooled into one series per agent group.
- Rounds: reconstructed from each run's contiguous `agent-rounds.jsonl` indexes.
- Usage: read from the run-level aggregate contract and, where the historical schema populated usage, independently checked against summed provider-round usage.
- Source usage-complete runs: 269; usage-unavailable runs: 1.
- Aggregate-only historical usage: 20 runs; their round contracts contain null usage fields.
- Success: `sum(passed) / sum(checks)` for weighted summaries; points retain run-level ratios.
- Cost: `(uncached input*5 + cached input*0.5 + output*30) / 1,000,000` USD.

## Formula test

The supplied formula is interpreted as `T(n) = nB + c*n*(n+1)/2`. Both candidate models have two parameters and are compared with leave-one-task-out RMSLE. The quadratic-context form is retained when its RMSLE is within 5% of the power-law model; otherwise `T(n) = a*n^p` is selected.

| Agent group | Quadratic CV RMSLE | Power CV RMSLE | Selected | Power-law estimate |
|---|---:|---:|---|---|
| Tura Balanced | 0.185 | 0.179 | quadratic-context | T(n) = 19055 n^1.498 |
| Tura Direct | 0.229 | 0.235 | quadratic-context | T(n) = 19884 n^1.444 |
| Codex CLI | 0.175 | 0.185 | quadratic-context | T(n) = 60413 n^1.152 |

**Conclusion:** Quadratic-context form retained for: Tura Balanced, Tura Direct, Codex CLI. Power-law alternative preferred for: none.

The result is an empirical cross-task relationship, not a claim that extra rounds cause success or token growth identically for every task. Task difficulty and model configuration remain visible as run-level scatter.

## Contract audit

- Token totals cross-checked against all 249 round contracts; maximum difference: 0 tokens.
- Costs cross-checked against 239 populated task contracts; maximum difference: $0.00000000.
- Excluded duplicate aggregate-usage snapshots: 5 rounds in 1 run; these rounds remain in the round count.
- Excluded exact run-aggregate usage snapshots: 1 round; it remains in the round count.
- The remaining historical cost fields were absent, not zero; they were recomputed from their recorded token components with the same benchmark pricing rule.
