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
keel canvas live --json
keel canvas rebase --json
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

A new connection is always in **immutable** mode: every sync that changes a
card adds a new run card in its native region, and nothing is edited in place.
That is the only mode for isocan builds through `1565e50`, whose public CLI has
no conditional edit. This limited mode does **not** establish the spec's stable
live pulse.

## Keep one pulse current (live mode)

isocan `7bb1f4e` added `isocan edit --if-version`: a new version lands only if
the card is still where the caller last saw it. With that build, the owner can
move a binding to **live** mode. The Project pulse then keeps one item id and
is updated in place. Every other card is still an immutable run card.

```sh
keel canvas live --json                 # preview: mode, retention, which card is adopted
keel canvas live --yes --json           # write the binding; no remote write
keel canvas live --keep 14 --yes --json # also keep only the newest 14 pulse versions
keel canvas live --off --yes --json     # back to immutable run cards
```

Moving to live writes `canvas.mode` (and `canvas.keepVersions`) in
`.keel/keel.json` and nothing else. The first live sync adopts the pulse this
journal already published, and only if exactly one remote card still carries
its operation with everything keel recorded at publication still exactly
there: version, both faces, title and **every property**, including ones keel
did not set. A binding that has never published creates exactly one. Zero,
duplicate or changed matches stop with nothing created or edited.

If a person edits, renames or re-tags that pulse before its first live sync
(before or after `keel canvas live --yes`), the sync refuses and names the way
out, which is the same as for any refused live card: `keel canvas rebase`, then
`keel canvas rebase --onto <version-id> --yes`. That re-base is the adoption.
The `live` preview lists such a card as `rebase-before-first-sync`. Several
cards carrying the pulse's operation still need manual investigation.

**A pulse published before 13 October 2026 needs that one explicit re-base.**
Its receipt has no recorded properties, so keel cannot show that nobody
re-tagged the card, and it does not assume so. The `live` preview says
`reason: "unrecorded-metadata"`; the first sync refuses until the owner has
looked at the card and re-based. The approved Keel canvas is in this state.
When keel's own content is still on the card, the re-base republishes nothing;
the next changed pulse is edited on top.

Keel's edit sets two properties, `keel.hash` and `keel.operation`, and never
removes or overwrites a property it did not set. After a re-base onto a card a
person renamed or rewrote, the next sync does replace what they see: a new
version with keel's content, and keel's title. Their version stays in the
stack unless retention later prunes it. The re-base preview says this.

Each update is one conditional edit. It carries the version and the exact
title and properties keel recorded last time, and an op id that is written to
the pending receipt before the call:

| isocan answers | Keel does |
| --- | --- |
| `applied` | reads the card back, verifies both faces by hash, records the new version |
| `replayed` | the same: an earlier send of this op id had landed; records what landed |
| `conflict` (exit 4) | writes nothing more to the card, records what it saw, exits 1 |
| `unsupported` (exit 5) | writes nothing, returns the binding to immutable, exits 2 |
| timeout, invalid JSON, killed | keeps the receipt; the next `sync --yes` sends the same op id and bytes again |

**A person's edit always wins.** If someone edits, renames or re-tags the live
card, keel stops updating it: `sync` and `status` report `state: "conflict"`
with an `attention` entry (the version keel expected, the current version, and
the title and properties found). The refusal is recorded and stays, even if
the card later looks unchanged again. No other card is added around a refused
pulse, and an unconditional edit is never sent. The owner looks at the card,
then says so, naming the version they looked at:

```sh
keel canvas rebase --json                       # preview: what is there now, what happens next
keel canvas rebase --onto <version-id> --yes --json
```

Re-basing writes nothing remote. The next sync sends keel's pulse as a new
version on top of that one and restores keel's title; the person's version
stays in the card's version stack.

To leave their card alone for good, use `keel canvas live --off` (or drop its
key from `--card`). The preview lists it as `retire-live-card`. With `--yes`,
keel stops tracking that card: it stays on the canvas exactly as the person
left it, its receipts stay in the journal under `retired`, `status` stops
reporting the conflict, and the next sync publishes a new card beside it.
A live card nobody touched is not retired; publication continues from it.

### Name which cards are live

By default the only live card is the one keyed `pulse`. A binding can name
others, for a caller that publishes its own cards through `canvasSync`:

```sh
keel canvas live --card loop-across-projects --json        # preview
keel canvas live --card loop-across-projects --yes --json
```

`--card` is repeatable and gives the **whole** list (1 to 16 keys): a key left
out, `pulse` included, is published as immutable run cards again. The list is
`canvas.liveKeys` in `.keel/keel.json`. Without `--card` the list is unchanged.

A live card is found by its **key**, so the caller must send the same key
every time. A key with a date in it is a new card each week, live or not. The
title may change freely: keel sends its own new title in the same conditional
edit as the content and records it, so next time it is the expected title and
not a person's rename.

A live key with no card yet creates exactly one on the first live sync. Keel
never adopts a card published under another key: earlier dated editions stay
on the canvas as history. Everything else about a live card is the same as for
the pulse: conflict, re-base, retention. When more than one live card is
refused, re-base them one at a time with `keel canvas rebase --card <key>`.

Retention is off unless `--keep <N>` (2 to 1000) is set. When on, keel runs
`isocan version prune <card> --keep N --force` after a confirmed `applied` or
`replayed`, for each live card and no other. Pruned versions are gone for good. A failed
prune is a warning in the result; the publication still stands.

Limits that remain: cards are written one at a time. There is **no atomic
multi-card publication**, so a sync can stop between cards; the last-success
receipt, not the canvas, says which publication is complete. Live mode has
been proven on a fake transport and against a throwaway local isocan daemon
only. Do not claim phase 50 built until the deployed concurrent-edit walk and
the night proof have been walked.

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
   `3b46f21`, `b61f7c1`, `1565e50` and `7bb1f4e`; native groups are
   additionally required, and live mode needs `7bb1f4e`.
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

A night in live mode is unproven on a real runner. Its recovery artifact
carries an unresolved pulse edit with its op id and exact bytes, and a refusal
with the title and properties a person left on the card; treat the artifact as
private as the canvas. A fresh checkout reads the committed binding, so a
binding returned to immutable by an unsupported home must be committed.
