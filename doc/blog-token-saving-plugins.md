# Token-Saving Plugins Are Mostly a Denominator Trick

I am tired of people believing every "save 90% of tokens" claim attached to a coding-agent plugin.

The trick is embarrassingly simple: compress one small part of a task, print a heroic percentage, then let readers imagine the whole bill fell by the same amount. If a plugin removes 90% of one `grep` result, it did not make the coding task 90% cheaper. It made one `grep` result shorter.

Confusing those statements is not optimism. It is losing a fight with the denominator.

## We ran the plugins on a repository rewrite

This was not a toy prompt asking for one function. The task was to **rewrite the Rust eza repository as a behavior-compatible Python implementation**. The agent had to inspect the reference project, reproduce the CLI in another language, and face **52 harness assertions**.

Every published run used **GPT-5.6-sol, High reasoning, and Codex CLI 0.144.1**. The comparison contains exactly two runs per arm:

- Ponytail r2/r3, both with **full hook + skill** activation;
- RTK r2/r3, both with isolated RTK activation;
- Caveman r1/r2, with its 20-skill Codex package installed in separate isolated homes and its exact primary skill body loaded through global `AGENTS.md`; and
- two previously published no-plugin runs with the same task, model, reasoning level, and CLI version.

| Arm | n | Harness score | Total tokens | Modeled cost | Rounds | Duration |
| --- | -: | ------------: | -----------: | -----------: | -----: | -------: |
| No plugin | 2 | 78.85% | 6.660M | $5.281946 | 62.5 | 895s |
| Ponytail, full hook + skill | 2 | 80.77% | **-7.56%** | **-8.87%** | -9.60% | +13.51% |
| RTK | 2 | 76.92% | **+13.20%** | **+7.18%** | **+44.00%** | **+40.69%** |
| Caveman skill package | 2 | 86.54% | **-4.03%** | **-3.90%** | -8.80% | +2.29% |

The complete public package is in the [matched plugin-run data directory](https://github.com/Tura-AI/benchmark/tree/main/blog_data/token-saving-plugin-eza). It contains sanitized per-run data, the computed summary, methodology, and a **407-round activation audit**. All eight Codex processes exited 0 and produced complete usage and evaluator data. A run can still miss harness assertions; that is the score, not a crashed experiment.

Ponytail looks 8.87% cheaper, RTK 7.18% more expensive, and Caveman 3.90% cheaper with a 7.69-point higher harness score. None of those two-run means is an effect estimate.

## The "saving" is smaller than ordinary run variance

The same agent, model, task, and configuration did not produce remotely stable bills across two repetitions:

| Arm | Cost in the two runs | Cost range / mean | Token range / mean | Round range / mean |
| --- | -------------------: | ----------------: | -----------------: | -----------------: |
| No plugin | $4.139647 - $6.424245 | **43.25%** | 53.02% | 40.00% |
| Ponytail | $3.569452 - $6.057281 | **51.69%** | 57.36% | 47.79% |
| RTK | $4.789893 - $6.532388 | **30.78%** | 39.75% | 26.67% |
| Caveman | $5.029889 - $5.122335 | **1.82%** | 2.92% | 17.54% |

Here, "range / mean" is the gap between the two runs divided by their mean. It is not a confidence interval; with n=2, pretending to have one would be statistical cosplay.

But the scale still matters. Ponytail's apparent **8.87%** cost saving sits inside a **51.69%** within-arm cost swing. RTK's apparent **7.18%** cost increase sits inside a **30.78%** swing. Even the no-plugin pair moves **43.25%** without any plugin to praise or blame.

The Caveman pair happened to be much tighter than the earlier arms, but two observations do not establish a stable variance or causal effect. Its baseline is historical rather than a same-day randomized pair, and activation was deliberately forced while preserving the task prompt. These data therefore do **not** identify a plugin effect; a larger paired experiment is still needed.

What the experiment does establish is simpler: a local compression claim does not reliably predict the complete-task bill. Ponytail and Caveman moved modestly down; RTK moved up. None resembles the giant percentage printed on a local optimization.

## Here is the actual coding-agent bill

The broader repository dataset contains **140 Codex CLI Medium and High runs**: **10,365 agent rounds, 901,608,531 tokens, and $680.34 in modeled API cost**. No Tura runs are included.

| What Codex consumed | Share of all tokens | Share of cost |
| ------------------- | ------------------: | ------------: |
| Cached input | **96.46%** | **63.91%** |
| New uncached input | 3.16% | **20.94%** |
| Model output | 0.38% | **15.14%** |

The complete calculation is in the [plugin token-savings analysis directory](https://github.com/Tura-AI/benchmark/tree/main/assets/plugin-token-savings). Under the repository pricing model, uncached input costs $5/M, cached input $0.50/M, and output $30/M. Cached input is one tenth the price of new input.

The six published plugin runs had the same shape: cached input was **96.74%** of Ponytail tokens, **97.27%** of RTK tokens, and **96.52%** of Caveman tokens.

Caveman's current README distinguishes its output-style skill from its proxy. For a Codex ChatGPT login, the upstream proxy path is currently metering-only, so our arm measures the installed skill package and its behavioral guidance, not proxy input compression. That boundary matters when comparing these results with Caveman's separate proxy benchmark claims.

A coding agent repeatedly carries prompt, history, commands, and command results into later rounds. Shortening one fragment can produce an impressive local percentage while barely touching the expensive complete trajectory.

## Prompt and LOC savings are especially good comedy

Ponytail's Codex rules contain about **569 tokens**. Give the claim every advantage: put those rules in every one of the 10,365 rounds and shorten them by 90% with zero quality loss. The modeled saving across all 140 runs is about **$2.98**, or **0.44%** of total cost.

That is roughly two cents per task. Please alert the finance department.

The LOC argument is worse. Recoverable final production code in the 140 runs contains **512,412 tokens**, only **0.0568%** of all tokens consumed. Suppose Ponytail magically removes **80% of every functional code token**, never deletes behavior, and never causes another reasoning step. Even valuing every removed token at the expensive output rate, the saving is **1.81%** of total task cost.

Less code can be better engineering. But using LOC reduction as evidence of a huge inference-cost reduction is like shortening item names on a restaurant bill and announcing that dinner is cheaper.

## RTK's 90% still belongs to a tiny slice

Across the 140 runs, we could uniquely classify **1,082 RTK-supported shell calls** containing **1,458,927 returned tokens**. That payload is just **0.1618%** of all task tokens. Apply a perfect 90% reduction to every eligible return and the directly attributable modeled saving is **0.96%** of total cost.

To manufacture a larger ceiling, we also assumed every compressible output remains in context until the task ends and gets reread on every later round. Under that deliberately generous fantasy, universal lossless 90% compression reaches **5.72%**.

So the marketing number can be 90% while the complete-task saving stays below 1%. It approaches 5% only after we grant permanent retention, perfect classification, perfect compression, and zero information loss. The rabbit is real; the hat is doing most of the work.

## One outside paper is enough

[Bai et al., *How Do AI Agents Spend Your Money?*](https://arxiv.org/abs/2604.22750) analyze trajectories from eight frontier models on SWE-bench Verified. They report that agentic coding consumes about **1,000x** more tokens than code reasoning or code chat, that **input rather than output drives total consumption**, and that runs on the same task can differ by up to **30x**. Higher token use also did not reliably mean higher accuracy.

That is the only external paper needed here. Coding-agent cost is a trajectory problem with huge run-to-run variance. A local compression ratio is not a task-level economic result. It is a numerator looking for an unsuspecting denominator.

## Do not mix our three evidence layers

Our repository separates three questions:

| Evidence | Scope | What it can support |
| -------- | ----- | ------------------- |
| **Matched plugin runs** | 6 plugin runs + 2 same-configuration no-plugin runs on one Rust-to-Python repository rewrite | A small end-to-end observation. Two-run arm means cannot establish causality; activation and proxy boundaries are reported separately. |
| **Broad cost distribution** | 140 Codex Medium/High runs across the published benchmark | Where tokens and modeled cost sit in coding-agent trajectories. |
| **Claim-rate scenarios** | Ponytail prompt/LOC and RTK command payloads mapped onto those 140 runs | Upper bounds and arithmetic counterexamples, not A/B outcomes. |

The [matched-run directory](https://github.com/Tura-AI/benchmark/tree/main/blog_data/token-saving-plugin-eza) and [broader analysis directory](https://github.com/Tura-AI/benchmark/tree/main/assets/plugin-token-savings) remain separate because mixing measured A/B outcomes with claim-rate scenarios would repeat the exact denominator trick being mocked.

Ponytail may be useful as an anti-overengineering discipline. RTK may be useful as a terminal-output formatter. Test those benefits honestly. Just stop waving "90%" around as if percentages are transferable between denominators.

## What real task-level saving looks like

Tura Direct does not celebrate shrinking one tool response. It changes the **complete agent policy** to reduce trajectory tokens and rounds. Across the same five repository-rewrite tasks, it recorded **8.37M tokens, 123 rounds, and $17.81** at a **74.8% harness micro-rate**. Codex Medium recorded **48.98M tokens, 425 rounds, and $43.66** at **74.4%**. That is **82.9% fewer tokens, 71.1% fewer rounds, and 59.2% lower modeled cost across the whole task set**, not 90% of one conveniently chosen crumb. These are observed complete-configuration results, not proof that one isolated Tura component caused the difference; the public runs are in the [rewrite results directory](https://github.com/Tura-AI/benchmark/tree/main/results/rewrite).

That is the denominator that matters. The calculator is free.
