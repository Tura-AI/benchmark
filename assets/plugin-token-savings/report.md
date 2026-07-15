# Ponytail and RTK: benchmark exposure and claim-rate scenarios

## Conclusion

The 140 published local harness runs contain 901,608,531 tokens and cost $680.34 under the repository pricing model. The table separates directly counted payloads from scenarios that apply vendor claim rates. The scenarios are not causal measurements of either plugin on this benchmark.

| Plugin and scope                                                           | Attributable local payload | Payload / all tokens |              Claim-rate scenario saving | Saving / all tokens |         Price-equivalent saving | Saving / actual cost |
| -------------------------------------------------------------------------- | -------------------------: | -------------------: | --------------------------------------: | ------------------: | ------------------------------: | -------------------: |
| Ponytail: final production-code body (130 runs with recoverable code)      |                    512,412 |              0.0568% |                276,702 at 54% less code |             0.0307% |         $8.3011 at output price |              1.2201% |
| Ponytail: vendor whole-session average extrapolation                       |                          - |                    - | 198,353,877 at 22% fewer session tokens |            22.0000% |       $136.07 at 20% lower cost |             20.0000% |
| RTK: uniquely classified command returns with an official per-command rate |                  1,458,927 |              0.1618% |                               1,148,746 |             0.1274% | $5.7437 at first uncached input |              0.8442% |

## Ponytail

The current vendor result is 54% less code, session tokens at 78% of baseline (22% less), and cost at 80% of baseline (20% less). Sources: [README](https://github.com/DietrichGebert/ponytail) and [agentic benchmark](https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-06-18-agentic.md).

The local production-code body contains 512,412 tokens measured with `o200k_base`. This covers 130 runs. The remaining 10 runs have line counts or recovery records but not enough source body to tokenize, so their code tokens remain missing rather than being guessed. Missing groups: archived-evaluator-source-lines=4, unrecoverable-untracked-source=6.

Applying the 54% less-code rate to the visible body yields 276,702 fewer code tokens. The price-equivalent column values them at the $30/M output rate because code is normally emitted in model output or tool arguments. It is not an independently traceable line on the provider bill.

Ponytail's 22% token and 20% cost reductions are averages from its own Haiku 4.5 experiment over 12 feature tasks with n=4. Multiplying those rates by this benchmark only answers a transfer scenario; it does not establish that the result transfers to GPT-5.6-sol or to the DeepSWE and rewrite workloads.

## RTK

RTK says common development-command output can be reduced by 60%-90% and publishes per-operation estimates for a 30-minute session. This analysis uses only operations with an explicit percentage in the [RTK README](https://github.com/rtk-ai/rtk).

| Command family                 | Uniquely classified calls | Observed return tokens | Official saving rate | Scenario saved tokens | First-input saving |
| ------------------------------ | ------------------------: | ---------------------: | -------------------: | --------------------: | -----------------: |
| `ls / tree`                    |                        29 |                 13,348 |                  80% |                10,678 |            $0.0534 |
| `cat / head / tail / rtk read` |                       164 |                254,353 |                  70% |               178,047 |            $0.8902 |
| `grep / rg / rtk grep`         |                       377 |                872,740 |                  80% |               698,192 |            $3.4910 |
| `git status`                   |                        82 |                 29,147 |                  80% |                23,318 |            $0.1166 |
| `git diff`                     |                        90 |                142,160 |                  75% |               106,620 |            $0.5331 |
| `git log`                      |                        11 |                  2,911 |                  80% |                 2,329 |            $0.0116 |
| `git add / commit / push`      |                         6 |                    394 |                  92% |                   362 |            $0.0018 |
| `cargo test / npm test`        |                       109 |                 82,895 |                  90% |                74,606 |            $0.3730 |
| `ruff check`                   |                        14 |                  2,865 |                  80% |                 2,292 |            $0.0115 |
| `pytest`                       |                        80 |                 30,120 |                  90% |                27,108 |            $0.1355 |
| `go test`                      |                       120 |                 27,994 |                  90% |                25,195 |            $0.1260 |
| `docker ps`                    |                         0 |                      0 |                  80% |                     0 |            $0.0000 |

The claim-rate-weighted scenario compression is 78.74%. Command returns are priced when they first enter the next model request as uncached input. The logs do not attribute each later cached replay to its original segment, so the analysis does not present cache-reuse savings as an exact bill reduction.

Batches containing multiple rated operations are not allocated to one family. Commands without an official per-operation rate, such as `find`, general builds, and other linters, do not inherit the headline range. This is conservative for RTK but avoids double counting output that cannot be separated reliably.

## Calculation boundaries

- The denominator is 140 published harness runs from codex-cli-high, codex-cli-medium. Totals come from `run-level-data.csv` and `excluded-runs.csv`.
- Total tokens equal input plus output. Cached input is a subset of input and is not added twice.
- Repository pricing is $5/M uncached input, $0.5/M cached input, and $30/M output.
- Debug code is the added production-source body in the final git patch. Rewrite code is production-source body in the retained workspace. Existing code-metric rules exclude tests, fixtures, harnesses, benchmarks, and references.
- Code tokens describe the unique final artifact body, not explanations, commands, overwritten drafts, or deletions. They measure retained code payload, not every token spent generating it.
- RTK return tokens are stdout plus stderr from leaf shell calls in the agent-round contracts, deduplicated by call ID. A call is included only when it maps uniquely to a command family with an official rate.
- Percentages use unrounded values; rounding is display-only.

## Reproducible artifacts

- `summary.json`: totals, shares, price scenarios, and diagnostic counts.
- `ponytail-code-runs.csv`: per-run code-body tokens and missing-data reasons.
- `rtk-operation-summary.csv`: per-family calls, return tokens, official rates, and scenario savings.
