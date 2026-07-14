# Official DeepSWE mini-swe-agent import

This dataset normalizes 24 official DeepSWE v1.1 trial summaries into the Tura
benchmark contracts. It is a provenance-preserving sample, not a new benchmark
execution and not a replacement for Tura's 180-run local matrix.

## Selection

The importer takes the first three tasks in the published Tura 20-task
inventory order:

1. `actionlint-action-pinning-lint`
2. `abs-stepped-slices`
3. `yaegi-go-embed-directives`

For each task it selects official rows with all of these fields:

- `source = deep-swe`
- `eval_scope = full`
- `included_in_score = true`
- `harness = mini-swe-agent`
- `model = gpt-5-6-sol`
- `reasoning_effort = high` or `medium`

Each task/effort group has four trials. Trials are ordered by `started_at`, with
`trial_name` as a stable tie-breaker, and assigned replicates 1 through 4. This
yields eight report manifests with three runs each.

## Imported result

| Effort | Passes | Input tokens | Cached input | Output tokens | Total tokens |       Cost | Agent steps |
| ------ | -----: | -----------: | -----------: | ------------: | -----------: | ---------: | ----------: |
| High   |  10/12 |   25,838,910 |   23,177,728 |       325,087 |   26,163,997 | $34.647384 |         388 |
| Medium |  11/12 |   11,794,524 |   10,499,072 |       207,305 |   12,001,829 | $17.945946 |         310 |

The canonical aggregate and source checksum are in
[`results/debug/deepswe-v1.1-gpt56-sol-mini-swe-agent-first3-audit.json`](../results/debug/deepswe-v1.1-gpt56-sol-mini-swe-agent-first3-audit.json).

## Contract mapping

Every imported run contains:

- the exact official trial-index row as `metadata/source-trial.json`;
- normalized run summary, task report, web run, harness report, agent metadata,
  CLI metadata, and contract manifest;
- the official task and harness contracts already used by Tura's local matrix;
- the original task instruction as the first-round prompt.

The official index publishes aggregate input, cached-input, and output tokens,
but does not publish the reasoning-token subset. The normalized
`reasoningTokens` field is therefore `null`; it is not replaced by a fabricated
zero. `totalTokens` is input plus output and does not double-count cached input.

The index also does not publish the installed `mini-swe-agent` version or exact
launch command. Those fields carry an explicit unavailable marker, while the
agent identity links to the upstream
[`SWE-agent/mini-swe-agent`](https://github.com/SWE-agent/mini-swe-agent)
repository.

The source rows advertise trajectory, agent-log, patch, and verifier files, but
this import intentionally contains only the trial-index publication. It emits
empty round collections and no commands or patches instead of synthesizing
detail. Official artifact URLs and availability flags remain in each web-run
contract so a later enriched import can join the same immutable `trial_name`.

## Reproduction

Run:

```sh
npm run import:deep-swe:official:first3
npm run schema:check
npm test
```

The importer reads the official
[`trials.json`](https://deepswe.datacurve.ai/artifacts/v1.1/trials.json) and
[`release.json`](https://deepswe.datacurve.ai/artifacts/v1.1/release.json), then
records the complete trial-index SHA-256 in every report manifest and the audit
file. The committed snapshot used SHA-256
`450d6191068a23d8f3ac45e619607ffe6a4b9f3a25615218af0c243c831b9cc8`.
