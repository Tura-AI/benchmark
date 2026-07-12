# Current Benchmark Test-Set Record

Status: public evidence record for the July 2026 published artifacts

This record states what the current Tura benchmark data proves, how the data
was collected and retained, and where the comparison is not yet controlled
enough to support a causal claim. It is intentionally stricter than a product
summary. A result is stated confidently only when the published artifacts can
be recomputed or directly inspected.

## 1. Scope and evidence levels

The current record covers two different evaluation surfaces:

| Surface                 |                            Published observations | Evaluation                                          |
| ----------------------- | ------------------------------------------------: | --------------------------------------------------- |
| DeepSWE v1.1 subset     | 20 tasks x 3 agents x 3 replicates = 180 sessions | Official binary verifier                            |
| Design/front-end subset |    2 tasks x 2 agents x 2 replicates = 8 sessions | Artifact and process audit; no scalar quality score |

The DeepSWE numbers are recomputed from the 180 published `summary.json` and
`source-harness-report.json` files under the three
[`results/debug`](../results/debug/) reports. The design findings come from the
eight archived [`design-run.json`](../results/design/) contracts, their HTML
workspaces, and their recorded tool calls. The two evidence types are not
interchangeable: verifier pass rates support quantitative capability claims;
eight unblinded design runs support concrete artifact and process findings,
not statistical generalization.

The task definitions, selection method, and reporting rules are documented in
the [benchmark methodology](benchmark-methodology.md),
[`tasks/debug/deep-swe-v1.1`](../tasks/debug/deep-swe-v1.1/),
[`deep_swe/select_tasks.py`](../deep_swe/select_tasks.py), and the canonical
task declarations. The executable rerun path is documented in the repository
[`README`](../README.md).

## 2. What was run

### 2.1 DeepSWE cohort

The fixed subset contains 20 DeepSWE v1.1 tasks: four each in Go, Python,
TypeScript, Rust, and JavaScript, and five in each declared difficulty band.
Each agent configuration receives the same task ID and official instruction,
starts from the task's pinned environment, runs without task-container network
access, and is evaluated by the corresponding official verifier.

The published configurations are:

| Configuration | Model       | Reasoning effort | Sessions |
| ------------- | ----------- | ---------------- | -------: |
| Codex CLI     | GPT-5.6 SOL | Medium           |       60 |
| Tura Balanced | GPT-5.6 SOL | High             |       60 |
| Tura Direct   | GPT-5.6 SOL | High             |       60 |

The matrix used the default service tier, bounded 90-minute agent runs, and
isolated workspaces. Tura was routed through its normal runtime and Bash command
surface. The same 20 task IDs appear in each of the three published replicates.

### 2.2 Design and front-end cohort

The design subset contains an East Asian squid recipe slide deck and an
interactive Paris summer-temperature 3D experience. Each was run twice with
Codex CLI and twice with Tura Direct, using GPT-5.6 SOL High for both agents.
These runs therefore provide a same-model, same-effort process comparison,
separate from DeepSWE's High-versus-Medium configuration comparison.

## 3. Acquisition, persistence, and provenance

The benchmark keeps three evidence layers.

1. **Raw execution layer.** Provider events, untouched stdout/stderr, agent
   summaries, prompts, workspaces, patches, and verifier output are written
   beneath the local ignored `raw/` tree while the run is active.
2. **Normalized contract layer.** Provider-specific callbacks are converted to
   schema-defined rounds, tool calls, usage, agent summaries, and harness
   reports. Cumulative usage snapshots are deduplicated; absent usage remains
   absent rather than being estimated.
3. **Published layer.** Compact run manifests, normalized summaries, source
   agent summaries, source harness reports, patches, and design workspaces are
   copied under [`results/`](../results/). Every published DeepSWE run retains
   task ID, agent ID, model, effort, replicate, source batch, token usage,
   rounds, elapsed time, patch metadata, and verifier outcome.

The collection and normalization boundaries are implemented in
[`deep_swe/run_matrix.mjs`](../deep_swe/run_matrix.mjs),
[`lib/generic_agent_cli.mjs`](../lib/generic_agent_cli.mjs), and the typed
contracts under [`src`](../src/). Published artifacts preserve the source
paths needed to trace a normalized record back to its physical execution
batch. Local absolute paths inside historical source records are provenance
captured at run time; they are not portability instructions.

No missing command, score, or token field is manufactured. A valid verifier
failure remains a failure. Retries and superseded physical attempts remain in
the raw attempt trees instead of being silently deleted; only the selected
published observation occupies a replicate slot.

## 4. What “same batch” does and does not mean

The comparison is cohort-aligned on the strongest stable boundaries:

- identical 20-task selection and task IDs;
- identical replicate numbers and 60-session denominator per agent;
- identical GPT-5.6 SOL model family and default service tier;
- pinned task environments and official verifier images;
- the same task-container network policy;
- the same normalized publication schema and scoring rule.

It is not literally one uninterrupted physical process. The final 180 records
were assembled from the initial matrix plus documented continuation and
recovery batches. This is acceptable because task identity, agent
configuration, replicate identity, source lineage, and verifier artifacts are
retained per observation. “Same cohort” is the accurate claim; “all 180 ran in
one process” is not.

## 5. Recomputed DeepSWE result

Every number in this table was recomputed from the 180 published summaries and
verifier reports. Tokens and rounds are aggregate observed totals; no outlier
was trimmed.

| Configuration      | Passes | Pass rate | Aggregate tokens | Rounds | Token change vs Codex | Round change vs Codex |
| ------------------ | -----: | --------: | ---------------: | -----: | --------------------: | --------------------: |
| Codex CLI Medium   |  38/60 |     63.3% |      333,538,349 |  3,140 |              baseline |              baseline |
| Tura Balanced High |  48/60 |     80.0% |      229,695,477 |  2,017 |                -31.1% |                -35.8% |
| Tura Direct High   |  39/60 |     65.0% |       75,108,167 |    969 |                -77.5% |                -69.1% |

These results support two strong statements.

1. In this published system configuration, Tura Balanced passed 10 more of 60
   verifiers than Codex CLI while using 31.1% fewer aggregate tokens.
2. Tura Direct used 77.5% fewer aggregate tokens and achieved a similar binary
   verifier result: 39 passes versus Codex CLI's 38.

They do not prove that one isolated runtime feature caused the difference.

## 6. Anomalies and severe long tails were retained

The totals include behavior that makes Tura look worse. This is deliberate.

| Configuration | Agent timeouts/non-zero exits | Median elapsed | P95 elapsed | Maximum tokens | Maximum rounds |
| ------------- | ----------------------------: | -------------: | ----------: | -------------: | -------------: |
| Codex CLI     |                             1 |       21.8 min |    65.0 min |     12,473,035 |             91 |
| Tura Balanced |                             8 |       35.3 min |    90.0 min |     35,464,917 |            242 |
| Tura Direct   |                             0 |       19.1 min |    61.2 min |      3,762,598 |             35 |

The worst Tura Balanced run,
`dynamodb-toolbox-conditional-attribute-requirements` replicate 1, timed out at
90 minutes after 35.46 million tokens and 242 rounds. It remains in Balanced's
229.70 million-token aggregate. Seven other Balanced agent executions and one
Codex execution also reached a non-zero timeout outcome. Where a verifier could
still evaluate the resulting workspace, the verifier result remained the task
outcome rather than being discarded.

One Balanced replicate of that same DynamoDB task also has a timed-out,
non-zero harness report and no valid completed verifier result. The published
headline nevertheless keeps it as a failure in the 60-run denominator, yielding
48/60 = 80.0%. This is conservative for Tura but is a protocol deviation from
the stated rule that infrastructure-invalid verifier runs should be excluded
until rerun. Excluding it would produce 48/59 = 81.4%; this record retains the
published 80.0% to avoid retroactively improving the headline.

This is what retaining long-tail evidence means: aggregate efficiency is not a
median-only story, and operational failures are not removed because they are
embarrassing.

## 7. Why Tura High is compared with Codex Medium

This is a comparison of named product configurations, not a controlled
reasoning-effort experiment. Tura uses High because its Balanced mode is meant
to spend the runtime's saved round-trip budget on deeper investigation and
verification; Direct uses the same High model setting while minimizing the
execution path. Codex Medium is the selected reference configuration.

That choice makes the efficiency result harder, not easier, in one narrow
sense: despite requesting High reasoning, both Tura configurations consumed
fewer aggregate observed tokens than Codex Medium. It also creates an obvious
confound: High and Medium are not the same treatment, so the pass-rate gap
cannot be attributed to the agent runtime alone.

The correct interpretation is therefore:

- valid: the named Tura High systems achieved the published pass/token/round
  outcomes against the named Codex Medium system;
- invalid: High-versus-Medium by itself proves Tura's architecture caused the
  gain;
- still required: a crossed 2x2 matrix running Tura and Codex at both Medium
  and High under otherwise identical benchmark conditions.

## 8. Compact context and missing ablations

Tura's archived contracts contain explicit `task_status.compact_context`
interventions. The product README reports an average 2.6 rounds from those
events to resumed execution, compared with an estimated 5.4 rounds for Codex
from sharp input-token drops. Codex does not expose an equivalent event, so
those two measurements are asymmetric. They are useful operational evidence,
not a randomized causal ablation.

There is no completed experiment that disables `compact_context` while holding
the rest of Tura fixed. There is likewise no completed isolation of
`command_run`, backward-reasoning instructions, operation manuals, task-state
management, or provider-cache effects. Claims that any one of these features
alone caused the aggregate savings would exceed the evidence.

## 9. Design and front-end evidence

Across the eight same-model, same-High-effort design runs, Tura used fewer
tokens and turns while recording substantially more evidence-gathering and
verification actions.

| Task, two replicates per agent | Codex tokens | Tura tokens | Token change | Codex turns | Tura turns | Recorded tool actions, Codex / Tura |
| ------------------------------ | -----------: | ----------: | -----------: | ----------: | ---------: | ----------------------------------: |
| Squid recipe slides            |    2,312,139 |   1,465,194 |       -36.6% |          27 |         20 |                            21 / 164 |
| Paris temperature 3D           |    2,387,714 |   1,185,246 |       -50.4% |          27 |         21 |                            22 / 100 |

Across both tasks, Tura used 43.6% fewer tokens and 24.1% fewer turns while
recording 264 tool actions versus Codex's 43. Tool actions are not a quality
score. They do, however, show where Tura spent the saved model budget: the Tura
runs record 82 web-discovery calls, 24 media inspections, 25 image generations,
browser/Playwright checks, link probes, and responsive-state verification.
The Codex runs record no equivalent media inspection and no archived browser
capture review.

### 9.1 Squid recipe links

The four public HTML artifacts can be inspected directly:

- Codex CLI: [run 1](../results/design/east-asian-squid-recipes-slides/report-20260711-design-matrix/codex-cli-r01/workspace/index.html), [run 2](../results/design/east-asian-squid-recipes-slides/report-20260711-design-matrix/codex-cli-r02/workspace/index.html)
- Tura Direct: [run 1](../results/design/east-asian-squid-recipes-slides/report-20260711-design-matrix/tura-direct-r01/workspace/index.html), [run 2](../results/design/east-asian-squid-recipes-slides/report-20260711-design-matrix/tura-direct-r02/workspace/index.html)

A structural URL audit and a title-level content audit give two different,
important results:

The audit was rerun on 2026-07-12. Across Tura's 20 slots, the 15 unique recipe
URLs all returned HTTP 200 with matching page titles, and the 15 unique YouTube
IDs all resolved through `yt-dlp`. Availability is time-sensitive; the exact
dish-match counts below come from page and video titles, not status codes alone.

| Agent, two runs | Direct recipe/content pages | Exact-dish recipe pages | Search or broad index pages | Specific YouTube `watch` pages | Exact-dish video titles | YouTube search-result pages |
| --------------- | --------------------------: | ----------------------: | --------------------------: | -----------------------------: | ----------------------: | --------------------------: |
| Codex CLI       |                  8/20 (40%) |       not fully audited |                 12/20 (60%) |                           0/20 |                    0/20 |                20/20 (100%) |
| Tura Direct     |                20/20 (100%) |             18/20 (90%) |                        0/20 |                   20/20 (100%) |             18/20 (90%) |                        0/20 |

Thus the Codex decks do not satisfy the literal requirement for a working
YouTube cooking-video link: every video destination is a search-results page.
Tura's decks use resolvable, specific video pages in all 20 slots. Title-level
inspection confirms 18 exact-dish matches. Two run-1 videos are neighboring
evidence rather than exact matches: `Bi mu da kao` links to a braised
cuttlefish/pork/egg video, and `Hot-pot squid` links to a general hot-pot video.
The same run has two method-level recipe sources rather than exact squid-dish
sources: a chicken-and-shrimp dry-pot recipe and a general hot-pot guide. Tura
run 2 is 10/10 exact at this level for both recipe pages and video titles.

Sixty percent of Codex's nominal recipe sources are Google searches, site
searches, or broad recipe indexes rather than direct dish pages. Every Codex
video destination is a YouTube search-results page, so none satisfies the
literal request for a cooking-video link. The remaining eight direct Codex
recipe pages include some technique substitutions; they were not all promoted
to exact-dish matches in this audit.

This is a title/page-identity audit, not a blinded culinary replication study.
It verifies destination type and obvious dish identity; it does not prove that
every ingredient quantity or cooking step in the deck faithfully reproduces
the cited source.

The artifacts are published under
[`results/design/east-asian-squid-recipes-slides`](../results/design/east-asian-squid-recipes-slides/).

### 9.2 Paris 3D implementation and validation

The four public HTML artifacts can be inspected directly:

- Codex CLI: [run 1](../results/design/paris-summer-temperature-3d/report-20260711-design-matrix/codex-cli-r01/workspace/index.html), [run 2](../results/design/paris-summer-temperature-3d/report-20260711-design-matrix/codex-cli-r02/workspace/index.html)
- Tura Direct: [run 1](../results/design/paris-summer-temperature-3d/report-20260711-design-matrix/tura-direct-r01/workspace/index.html), [run 2](../results/design/paris-summer-temperature-3d/report-20260711-design-matrix/tura-direct-r02/workspace/index.html)

Both Tura artifacts implement an actual Three.js/WebGL scene with a
`PerspectiveCamera`, explicit camera position/look-at behavior, depth-aware
geometry, and rendering through `WebGLRenderer`. The archived Tura runs execute
real-browser checks, inspect desktop/tablet/mobile captures, verify WebGL
rendering and console state, and exercise year and metric selection. This is
direct evidence that the intended camera angle and interaction path were
validated, not merely written.

The Codex artifacts use CSS 3D transforms and stacked `z-index` layers. Public
inspection of those HTML pages found incorrect viewing angles and layer-order
problems that weaken the intended 3D reading. This is a disclosed human
artifact observation, not an automated harness score; readers can verify or
challenge it against the four links above. The archived Codex process records
syntax and disclosure checks but no equivalent real-browser screenshot review.

Tura's screenshot work is not inferred from a closing claim. Its published run
contracts record Playwright capture generation at 1440, 768, and 390 pixels,
three subsequent `read_media` inspections, WebGL and console checks, and
interaction assertions. The capture files themselves remained in the ignored
raw workspace rather than the published result tree. The durable public
evidence is therefore the run contract plus the final HTML, while future runs
should publish the captures alongside both agents' artifacts.

The artifacts are published under
[`results/design/paris-summer-temperature-3d`](../results/design/paris-summer-temperature-3d/).

## 10. How fewer tokens funded more verification

The observed pattern is not “Tura does less.” Tura makes fewer model round
trips, batches independent commands into one structured execution step, and
keeps tool output attached to normalized rounds. The saved model-context budget
can then be spent on external work that does not require another full prompt
replay: repository search, source retrieval, generated assets, browser checks,
link validation, responsive captures, and test reruns.

DeepSWE shows the same distinction. Codex used 3,140 model rounds and 2,496
recorded commands. Balanced used 2,017 rounds but 10,149 commands; Direct used
969 rounds and 4,340 commands. Command counts are not comparable as atomic work
units because Tura's macro calls and Codex's shell calls have different
granularity. Still, the direction is unambiguous: lower model-round cost did
not come from avoiding execution and verification.

The causal mechanism remains a hypothesis until feature ablations are run.
The observed system-level fact is already strong: fewer aggregate model tokens
coexisted with more archived verification activity and, for Balanced, more
DeepSWE verifier passes.

## 11. Limitations

- The DeepSWE subset is deterministic and stratified, not a random sample of
  all software work.
- Three replicates reduce stochastic noise but do not create 60 independent
  tasks; outcomes within a task and repository are correlated.
- High-versus-Medium confounds agent/runtime and effort.
- Compact-context and feature-level effects have not been ablated.
- Token totals measure observed provider usage, not a universal dollar cost;
  cache pricing and provider policy can change.
- The design sample has only two tasks and two replicates, no blinded reviewers,
  and no validated scalar quality rubric.
- A direct URL is not by itself proof of content relevance, and a successful
  page load is not proof of culinary accuracy.
- The Paris comparison lacks retained Codex screenshots, preventing a symmetric
  post-hoc visual inspection.
- A verifier can be imperfect. Passing the current harness proves conformance
  to that harness, not maintainability, security, or upstream acceptance.

## 12. Next experiments

1. Run the crossed Tura/Codex x Medium/High effort matrix with identical task,
   timeout, service-tier, and concurrency policies.
2. Ablate `command_run`, `compact_context`, backward-reasoning instructions,
   and operation-manual loading one at a time and in selected interactions.
3. Predeclare infrastructure-invalid handling, automatically enforce it, and
   publish both intent-to-run and valid-verifier denominators.
4. Report paired task-level confidence intervals and bootstrap sensitivity,
   not only pooled session percentages.
5. Add a deterministic design integrity harness for link type, HTTP status,
   video-page identity, local assets, browser console state, viewport captures,
   WebGL availability, and interaction paths.
6. Add blinded multi-reviewer visual and editorial scoring with a predeclared
   rubric and inter-rater agreement.
7. Retain browser captures for every design agent so visual claims can be
   reviewed symmetrically after publication.

## Conclusion

The current evidence is sufficient to be unequivocal about the published
system-level result: on this fixed 20-task DeepSWE cohort, Tura Balanced passed
more verifiers with fewer aggregate tokens and rounds, while Tura Direct
matched the reference pass count within one run at a fraction of the token and
round budget. Severe Tura long tails and failures were retained rather than
trimmed. In the small same-effort design cohort, Tura also used fewer tokens
while preserving far more source, media, link, browser, and responsive
verification evidence.

The evidence is not sufficient to assign those gains to one feature or to call
the effort settings controlled. Those are limitations to test next, not reasons
to dilute the results that are already directly reproducible.
