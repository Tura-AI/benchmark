# Debug workspace recovery

DeepSWE debug runs historically retained `model.patch` and verifier evidence but
removed their temporary `_workspaces` checkout after patch capture. Published
Codex and Tura runs therefore had `git-diff.patch` but no browsable
`workspace/` directory.

The recovery command rebuilds a deterministic **changed-files workspace** for
each selected run:

```powershell
npm run recover:debug-workspaces
npm run check:debug-workspaces
```

The first command discovers each published `metadata/summary.json`, maps its
`sourceBatch` back to the raw DeepSWE manifest, verifies or restores
`metadata/contracts/git-diff.patch`, and creates `workspace/`. The second
command is read-only and exits non-zero if any selected run lacks a matching
diff or workspace.

## What is in `workspace/`

Debug repositories can be large, so the published directory contains only the
files changed or added by the agent. Deleted paths are recorded in
`workspace/.benchmark-workspace.json`; unchanged repository files are not
copied. This is an evidence snapshot for review, not a complete runnable clone.

Every workspace manifest records the raw patch SHA-256, source batch and run,
pinned repository and base commit, included and deleted paths, and recovery
method. During legacy recovery the command:

1. reads the raw `model.patch` and its embedded pre-change Git blob IDs;
2. obtains the pinned blobs from a partial Git mirror under
   `raw/_cache/debug-workspace-recovery/`;
3. applies the patch to a synthetic index;
4. regenerates the staged binary diff and requires it to match the raw patch
   byte for byte; and
5. atomically installs the verified changed files as `workspace/`.

Some already-published third-replicate raw run directories were pruned after
normalization. For those runs the command uses the retained, normalized
`git-diff.patch` copy together with the raw manifest, raw source summary, and
pinned repository metadata; the workspace manifest records this fallback as
`published-diff-raw-copy`.

One interrupted legacy Tura run stopped before `model.patch` was written, but
its raw Git checkout was retained. For this case the command builds a temporary
Git index at the pinned base commit, stages the retained final worktree without
changing it, and generates the binary diff used for the published snapshot.
The manifest records `retained-raw-git-workspace`,
`originalPatchAvailable: false`, and verification against the retained
worktree; it does not claim comparison with an original patch that never
existed.

It refuses to publish a workspace when the raw and published patches differ or
when the exact baseline blobs cannot be recovered. Use `--offline` to prohibit
network access and rely only on the cache. Use `--overwrite` only when replacing
an existing workspace whose manifest does not match the raw patch.

Useful filters:

```powershell
# One report or task
node scripts/recover_debug_workspaces.mjs --report report-deepswe-v1.1-gpt56-sol-local-r01
node scripts/recover_debug_workspaces.mjs --task abs-stepped-slices

# Inspect mappings without writing
node scripts/recover_debug_workspaces.mjs --dry-run

# The default covers Codex, Tura Balanced, and Tura Direct.
# Use this for any additional agent types.
node scripts/recover_debug_workspaces.mjs --all-agents
```

## Guarantee for new raw runs

`deep_swe/run_matrix.mjs` now captures the changed-files workspace into each
raw agent run at `runs/<task>/<agent>-r<N>/workspace/` immediately after it
writes `model.patch` and before it removes the temporary checkout. The
directory is created even for an empty or deletion-only patch because it always
contains `.benchmark-workspace.json`. This capture is in the shared agent path,
so it runs for Codex, Tura Balanced, Tura Direct, and any other configured
matrix agent.

Consequently, new publications copy an already captured raw workspace. The Git
blob reconstruction path exists for legacy raw batches only. Run `--check` as
the publication gate to guarantee that every selected result contains both
`workspace/` and a byte-identical `git-diff.patch`.
