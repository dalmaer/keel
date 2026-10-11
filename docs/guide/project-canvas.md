# See the project's life on a canvas

`keel canvas` collects a read-only view of the practice: goals and phases,
Loop findings, lessons and learning proposals, captured retros, health and test
history, plus source coverage. Source files retain their decisions and acceptance;
GitHub retains merge facts. Missing data stays unknown.

Start locally; these commands need no isocan installation or account:

```sh
keel canvas snapshot --output /private/tmp/keel-snapshot.json --json
keel canvas render --snapshot /private/tmp/keel-snapshot.json --output /private/tmp/keel-view --json
```

Use fresh output paths: existing artifacts are not overwritten. Open the
resulting `pulse.html`. Date, goal, subproject and source filters change the
view only. Current counts are not claims about changes during a date window.
Evidence links show which source revision was inspected. A dirty worktree is
labelled local/uncommitted. Add `--github` to snapshot for fresh remote reads.

Repeat `--artifact <repo-relative-json>` to include saved lifecycle observations
and `--history <repo-relative-json>` for earlier snapshots. `--window-days 30`
selects the cohort window. Inputs must belong to this project and retain their
original observation timestamps; supplying a file does not make it fresh.
Dependency, review, queue and fleet coverage needs these recorded artifacts;
GitHub refresh currently observes PRs referenced by reconciliation records.
Missing baselines remain unknown. The metric selector exposes every measure,
including dated health series and their contributing records.

## Connect deliberately

The inspected isocan checkout supports groups; the older globally installed
CLI does not. `KEEL_ISOCAN` may name an executable for a tested checkout or a
wrapper, never a shell command. The adapter verifies capabilities and identity.
It does not log in, change identities or alter sharing for you.

```sh
keel canvas connect --create --title Keel --home https://isocan.io --space <space-id> --audience owner-only --json
keel canvas connect --canvas <complete-canvas-address> --audience owner-only --json
```

Choose one form. The first creates in an explicitly selected owned space; the
second attaches an existing canvas. Both preview first, and require `--yes` to
apply. Only verified owner-only access is currently supported. The owner chooses
the home, space and identity before a write; no model spend is involved.

```sh
keel canvas sync --dry-run --json
keel canvas sync --yes --json
keel canvas status --json
keel canvas disconnect --json
```

Disconnect previews disabling publication; `--yes` applies it and leaves the
remote canvas intact. Local receipts in `.keel/canvas/` identify managed items,
content hashes and unfinished operations. Keep them for recovery. An ambiguous
create is never blindly retried; status reports the pending operation.
Successful publication saves hash-verified snapshots beside the journal for
future cohorts. Keep the manifest and its referenced history together. Local
history is retained for 90 days; this does not delete remote cards. The night
practice restores the latest trusted attempt's recovery artifact, including
failed attempts, and refuses to replace missing state with an older journal.

The public isocan CLI inspected here has no conditional general-purpose edit.
Publishing therefore adds immutable run cards in native regions rather than
risking overwriting a human edit. This limited mode does **not** establish the
spec's stable live pulse, atomic publication or retention requirements. Do not
claim phase 50 built until its remaining proofs have been walked.

## Capture a retro without publishing a transcript

Ordinary `keel retro` remains read-only. `keel retro capture --record <file>`
validates and previews an authored JSON summary; `--yes` saves it under the
configured retros directory. Decisions are pending, picked or declined; picked
and declined choices require the owner's attribution, date and reason. It never
chooses for you. Only explicitly selected supported sessions can contribute
aggregate counts; manual and unsupported-provider summaries carry their coverage.
Raw transcripts, commands and private local pointers are excluded.

See `keel --agent-help canvas` for command details and the [specification](../specs/isocan-project-canvas.md)
for the record schema, metrics and open acceptance work. The [night practice](../../practices/night/README.md)
describes opt-in publishing from the existing measured report. Scheduling stays
off until tools, identity and access have been explicitly provisioned.

## Prepare a GitHub night writer

Prepare this separately from a local canvas connection; an approved local
writer does not provision credentials on GitHub. Keep the original connection
manifest and referenced history. A fresh runner must restore them, including
an interrupted attempt, before publishing.

The existing night step expects the following concrete setup through the
project's approved `setup` mechanism:

1. Install the pinned Keel and inspected isocan executables on `PATH`.
   Set `KEEL_CANVAS_KEEL_VERSION` and `KEEL_CANVAS_ISOCAN_VERSION` to their
   exact `--version` output. Keel currently accepts inspected isocan builds
   `3b46f21`, `b61f7c1` and `1565e50`; native groups are additionally required.
2. Provision a dedicated, already admitted isocan home directory using the
   provider's supported identity mechanism. Set `KEEL_CANVAS_ISOCAN_HOME`
   to that directory. Do not put credentials in the repository, manifest or
   uploaded artifacts, and do not manufacture an upstream badge identity.
3. Restore the original `.keel/canvas/manifest.json` and its history into the
   intended project. Verify its canvas, home, project key and writer match the
   approved binding. Never bootstrap by reconnecting after an uncertain write.
4. Only after tools and credentials are provisioned, set the existing
   binding's `canvas.enabled` to `true` and `canvas.cadence` to `nightly`.
   Verify owner-only access and perform a manual night/restart walk before
   relying on unattended publication.

The night consumes its existing report; it does not run a second gate or
invoke a model to publish. There is no additional model budget, but the owner
must approve credential provisioning and any additional runner usage. Missing
credentials fail visibly and retain the last successful publication.
