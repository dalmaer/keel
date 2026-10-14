# Evidence: phase 50 — a binding names its live cards, and two stuck states are unstuck

- Date: 2026-10-13 (local `date`; 2026-10-14 UTC)
- Phase: [50](../phases/50-project-life-on-isocan.md)
- Revision: base `a48784d` (PR #126 merged) plus three commits on
  `claude/phase-50-live-cards`: `96dae81` (live card keys), `1546be1`
  (retire on leaving live) and the add-recovery fix that follows them.
- Source: isocan CLI `0.1.0 (7bb1f4e, 2026-10-13)`, unchanged from
  [the live pulse evidence](2026-10-13-canvas-live-pulse.md).
- Claim being checked: a caller's own card key, named live in the binding, is
  one card updated in place; keel#127's two states no longer need a re-base.

**No real canvas was written.** No isocan.io, no real identity, not the
approved canvas, not the reporting workspace. Proof is the fake transport and
a throwaway isocan daemon on loopback with a made-up identity.

## Why

Live mode applied only to a card keyed `pulse`. The approved binding is
published by a weekly script that calls `canvasSync` with its own keys, one
per edition, so moving it to live would have changed nothing.

## Automated checks

All in `tests/canvas-sync.test.mjs` unless said, on the fake transport.

| Claim | Test | Red without it |
| --- | --- | --- |
| `--card` is previewed, validated, replaces the list; no list means `pulse` | "live --card is previewed, validated and replaces the list; without it the default stays the pulse alone" | new with the feature |
| A caller's live key is created once, then edited in place with a changing title; an unlisted key in the same sync is still a new card | "a caller-supplied live key is created exactly once, then edited in place week after week with keel's own changing title; an unlisted key in the same sync is still a new card" | new with the feature |
| Conflict and re-base on a caller's live key | "a person's edit to a caller-supplied live card refuses, stays refused, and is re-based by naming the card" | new with the feature |
| keel#127 item 1 | "live --off after a person edited a live card retires it: status clears and the next sync publishes beside their untouched card" | `keel prove … --name "retires it" --fix lib/canvas-sync.mjs lib/canvas-night.mjs`: VERIFIED, red at `96dae81` |
| keel#127 item 2 | "an add that lands and then times out in live mode recovers as the live card with its full metadata, and needs no re-base" | `keel prove … --name "lands and then times out in live mode" --fix lib/canvas-sync.mjs`: VERIFIED, red at `1546be1` |
| CLI flags | `tests/canvas-cli.test.mjs`: "live and rebase preview first, validate flags before transport, and change only the binding" | extended |

The three feature tests were written with the feature, so they were never run
red against the code before it. Default behaviour is held by the tests from
the live pulse work, which pass unchanged apart from the fake transport now
naming its file tags the way isocan does.

`npm run check` is the integrated gate; its result is in each commit body.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Reran the local walk from the live pulse evidence on this code: real CLI, throwaway daemon, `keel canvas sync`, `live --keep 3 --yes`, change a source, sync | adoption with no re-base, since the receipt now records metadata | `published`, `live[0].status: applied`, same item, 2 versions | Recorded metadata matches what real isocan puts on a card: keel's four properties plus `file` and `visualFile`, both named by the add's operation id. |
| Same daemon: `keel canvas live --card loop-across-projects --card pulse --keep 3`, preview then `--yes` | list replaced; create on first sync | Exit 3 with `set-live-cards` and `create-live-on-first-sync`; then `live` | The flag end to end. |
| Same daemon: a script calling `canvasSync` three times with key `loop-across-projects`, titles "Loop across projects · 2026-10-12" then "· 2026-10-19" twice, plus a dated `controls-<date>` key | one card, edited in place; dated key adds a card each week; third run unchanged | Week 1 `add-live` + `add-immutable`; week 2 `edit-live` `applied` + `add-immutable`; third `unchanged`. `ls`: one `loop-across-projects` card titled "· 2026-10-19" at 2 versions, two `controls-*` cards | A caller's live key works against the real CLI, including keel's own retitle. |
| The first attempt at that script | | Timed out in a help probe while the daemon was still starting, before any write; rerun clean | A cold local daemon can exceed the 15 s transport timeout. Not investigated further. |
| keel#127's two fixes on the real CLI | | Not run | Fake transport only. |
| Anything on the approved canvas or the reporting workspace | | Not run | Owed; the owner's step. |

## Gaps and decision

Proven on synthetic and local transports only. The add-recovery fix accepts a
card's properties as the publication's own only when each is one keel set or a
file tag named by that add's operation id. A home that adds any other property
at creation would fall back to the explicit re-base; isocan.io was not asked.
Phase 50 stays `partial`.
