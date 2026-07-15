# Token-Saving Plugins Are Mostly a Denominator Trick

I am tired of people believing every "save 90% of tokens" claim attached to a coding-agent plugin.

If you know how a coding agent works, the trick is obvious: take one small part of the task, report a huge reduction on that part, then quietly encourage readers to imagine the same reduction on the whole bill.

If a plugin removes 90% of `grep` output, it did not make the coding task 90% cheaper. If an agent writes 80% fewer lines, it did not use 80% fewer tokens. Believing otherwise is not optimism. It is losing a fight with the denominator.

## Here is the actual bill

Our benchmark contains **140 Codex CLI Medium and High runs**: **10,365 agent rounds, 901,608,531 tokens, and $680.34 in modeled API cost**. No Tura runs are included. The complete calculation is in the repo's [`summary.json`](../assets/plugin-token-savings/summary.json), with per-run code counts in [`ponytail-code-runs.csv`](../assets/plugin-token-savings/ponytail-code-runs.csv) and command counts in [`rtk-operation-summary.csv`](../assets/plugin-token-savings/rtk-operation-summary.csv).

| What the agent consumed | Share of all tokens | Share of cost |
| ----------------------- | ------------------: | ------------: |
| Cached input            |          **96.46%** |    **63.91%** |
| New uncached input      |               3.16% |        20.94% |
| Model output            |               0.38% |    **15.14%** |

This is how coding agents work: every round carries the accumulated prompt, history, tool calls, and tool results forward. Most of that repeated context becomes cached input. Under the benchmark pricing, uncached input costs **$5/M**, cached input **$0.50/M**, and output **$30/M**. Cached input is one tenth the price of new input. See the repo's [pricing methodology](benchmark-methodology.md) and OpenAI's [pricing](https://developers.openai.com/api/docs/pricing) and [prompt-caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching).

So when someone proudly says, "We shortened the agent prompt by 90%," ask what that prompt cost in the complete task. Otherwise they are celebrating a discount on the cheapest repeated part of the bill.

Ponytail's Codex rules contain about **569 tokens**. Assume they appear in every round and can be cut by 90% with absolutely no quality loss. Across all 140 runs, the saving is about **$2.98**, or **0.44% of total cost**.

That is roughly two cents per coding task. Stunning. Try not to spend it all at once.

## The LOC argument is even sillier

[Ponytail](https://github.com/DietrichGebert/ponytail) reports **54% less LOC, 22% fewer session tokens, and 20% lower cost** in its own Haiku 4.5 benchmark. Those are three different measurements. The latter two may be useful if independently reproduced. The first does not mathematically cause them.

Our recoverable final production code contains **512,412 tokens**. That is only **0.0568% of all tokens used by the 140 Codex runs**. The per-run evidence and missing-body handling are in [`ponytail-code-runs.csv`](../assets/plugin-token-savings/ponytail-code-runs.csv); the repository's broader relationship between submitted code and harness success is documented in [`current-test-set-record.md`](current-test-set-record.md#5-submitted-production-code-volume-and-harness-success).

Now make the assumption as favorable as possible: Ponytail removes **80% of all final functional code**, perfectly, with no missing behavior and no extra reasoning. Even pricing every removed code token at the expensive output rate, the equivalent saving is only **$12.30**, or **1.81% of total task cost**.

So yes, "80% less code" can coexist with "less than 2% cheaper." This is not paradoxical. It is arithmetic.

Less code can improve maintenance. It can reduce pointless abstractions. Those are legitimate engineering benefits. But selling fewer LOC as a major token-cost breakthrough is like removing the receipt from a grocery bag and claiming the groceries now weigh less.

## RTK saves 90% of a thing that barely reaches the bill

[RTK](https://github.com/rtk-ai/rtk) compresses terminal output and advertises **60%-90% savings** for supported commands. Unlike the LOC argument, this at least targets context that can be large and repetitive.

We mapped its published per-command rates to **1,082 uniquely classifiable shell calls** in the Codex runs. Their returns contain **1,458,927 tokens**, only **0.1618% of all task tokens**. Apply RTK's own rates and the directly attributable saving is **$5.74, or 0.84% of total cost**. Give every eligible command a perfect 90% reduction and it becomes **$6.57, or 0.96%**. The command-by-command evidence is in [`rtk-operation-summary.csv`](../assets/plugin-token-savings/rtk-operation-summary.csv).

To push the number as high as possible, we also calculated an absurdly generous upper bound: every compressible command output remains in context until the task ends and is reread on every later round. That produces **4.96%** using RTK's actual rates, or **5.72%** under a universal lossless 90% reduction.

In other words, the observable saving is below 1%. It reaches roughly 5% only after giving the plugin a fantasy scenario in which every eligible output survives forever and compression never removes anything useful.

The big "90%" was real. The implied saving was not. Again: denominator.

## Saving four cents can easily cost five dollars

The average Codex run in this dataset costs **$4.86**. RTK's directly attributable scenario saves about **$0.041 per run**. A cost increase of only **0.84%** erases the saving. At the observed average cost per round, roughly **0.6 additional rounds per task** are enough.

That matters because missing information causes more searches, repeated commands, extra tests, and sometimes failure. This benchmark's [round analysis](current-test-set-record.md#42-round-count-and-fitted-success-probability) also shows that extra rounds are not automatically waste: for Codex Medium, moving from the first to third round-count quartile corresponded to a fitted **+8.7 percentage-point** success difference. Sometimes those rounds are diagnosis and verification doing their job.

The research says the same thing more politely:

- [Bai et al. (2026)](https://arxiv.org/abs/2604.22750) find agentic coding tasks consume about **1,000x** more tokens than code chat or code reasoning, driven mainly by repeated input; identical task/model runs can vary by **30x**.
- [Shin et al. (2026)](https://arxiv.org/abs/2601.14470) find code review consumes **59.4%** of tokens in their ChatDev study, while initial coding is a much smaller part of the workflow.
- [Xiao et al. (2026)](https://arxiv.org/abs/2509.23586) show that careful trajectory reduction can cut input tokens **39.9%-59.7%** and total cost **21.1%-35.9%** without hurting performance. But their crude deletion baseline reduced pass rate by **7%** and increased steps by **14%**.
- [SWE-agent](https://arxiv.org/abs/2405.15793) and [Agentless](https://arxiv.org/abs/2407.01489) show that interface and workflow design matter. [Lost in the Middle](https://arxiv.org/abs/2307.03172) shows why removing noise can help, but also why preserving the right information matters more than maximizing a compression percentage.

Notice what the successful research optimizes: the trajectory, workflow, and information quality. Not a tiny prompt fragment. Not LOC as a vanity metric. Not one terminal command shown without the complete-task denominator.

## Before believing the next 90% claim

Ask four questions:

1. What percentage of the **complete task** did the compressed material represent?
2. Was it cached input, uncached input, reasoning, or expensive output?
3. Did success rate, rounds, retries, or latency get worse?
4. Was the result measured on paired tasks, or merely multiplied from a README claim?

If those numbers are missing, the plugin is not showing savings. It is showing a magic trick for people who stop reading at the percent sign.

Ponytail may still be useful as an anti-overengineering discipline. RTK may still be a good terminal-output formatter. Use them for those benefits if they survive an A/B test.

Just stop pretending that removing 90% of 0.16% is a revolution in agent economics.
