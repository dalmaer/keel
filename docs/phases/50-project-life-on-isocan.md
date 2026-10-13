---
status: partial
since: 2026-10-10
goal: G5
spec: 2
depends: [2, 10, 26, 40]
note: "Local collection, interactive render, reviewed retro capture, immutable sync and the conditional live pulse are implemented. Approved immutable dashboards and deployed recovery replay verified; packed connection/restart proof passes. Live mode is proven on a fake transport and a throwaway local daemon only: the deployed concurrent-edit walk, GitHub writer and night proof remain."
evidence: ["evidence/2026-10-08-project-canvas.md", "evidence/2026-10-09-canvas-reconciliation.md", "evidence/2026-10-10-canvas-recovery.md", "evidence/2026-10-13-canvas-live-pulse.md"]
---

# A project's isocan canvas shows what Keel improves

## Done when

An adopted project has a persistent isocan canvas showing its complete Keel lifecycle, with source-linked measures of fixes and improvement that survive repeated synchronization without changing source acceptance or overwriting human work.

## Scope

Implement [the project canvas specification](../specs/isocan-project-canvas.md):
optional connection, source collectors, coverage-aware snapshots, native groups,
source/visual pulse, explicit retro capture, safe sync and existing-night hooks.
The five delivery slices in that spec define the build order. Fleet-wide
aggregation follows the per-project walk; no additional tracking authority.

## Acceptance

- [x] All lifecycle sources, both phase shapes, stable identities and unknown coverage are normalized without inventing facts: `tests/canvas-snapshot.test.mjs`. Dependency/review/queue/fleet adapters consume explicit saved artifacts; missing artifacts stay unknown.
- [x] Metrics distinguish fixes, declined/stale findings, acceptance, merge, production verification and lived-in evidence; source links and accessible filters work: `tests/canvas-render.test.mjs` and the local Keel browser walk.
- [x] Connect, sync, retry and recovery preserve stable item ids and human edits, with no blind retries after ambiguous creation: `tests/canvas-sync.test.mjs` proves immutable mode and the stable live pulse (applied, conflict by version and by metadata, replayed, unsupported, op id reuse, retention) on a fake transport. Deployed concurrency is not an automated proof; it is owed in the by-hand item below.
- [x] Retro capture is explicit, reviewed and redacted; owner choices remain authoritative and unsupported providers remain unknown: `tests/canvas-retro.test.mjs`.
- [ ] The existing night publishes its measured snapshot without repeating the gate or invoking a model: `tests/canvas-night.test.mjs` exercises the workflow shell and a live journal's export and restore; the deployed credential and restart walk remains, in either mode.
- [x] CLI help, optional practice installation/migration and the packed CLI agree: `npm run check`.
- [ ] ⚑ by hand: owner approves home, space, audience and writer access; conductor performs the real isocan walk in spec slice 5, including concurrent-edit protection and restart recovery, and records evidence.

## Your part

The owner approved the private destination and Keel writer on 2026-10-08;
that decision is settled and must not be asked again. Canvas
`prj_9CgFY5l-na`, private space `spc_JA2u7KSKSI`, writer `usr_FkZbi3ZGqT`.
The weekly local report task is approved and active (Monday 08:00 Denver).
GitHub night credentials and scheduled access are a separate, unprovisioned
surface; prepare its concrete setup before requesting any new credential.

Moving that approved canvas from immutable to live mode is a new decision and
is the owner's: it changes how the existing pulse card is written. Nothing
moves it until the owner runs `keel canvas live --yes`.

## Real surfaces

- Owner's machine: installed isocan creates and updates a private canvas; verify native groups, visual/source faces, source links, identity and conflicts in the browser.
- Published package: pack and install Keel, connect and render from a fresh adopted project without importing isocan's SDK.
- Workflow shell: opt-in night uses actual credentials and one-writer configuration; prove offline/auth-expiry/interrupted-write behavior.
- GitHub API: compare observed PR merge and CI facts with source phase acceptance, including a merged-but-unaccepted example.
- Adopted project: follow Loop, lesson and retro outcomes to real evidence in the source records; edited cards and human notes survive a sync.

## Proof

Focused proof commands (use the test ledger reporter as shown):

```sh
node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout tests/canvas-snapshot.test.mjs tests/canvas-render.test.mjs tests/canvas-sync.test.mjs tests/canvas-retro.test.mjs tests/canvas-night.test.mjs tests/canvas-cli.test.mjs tests/canvas-package.test.mjs
npm run check
```

Use the test ledger reporter for focused runs as well. Execute the spec's five
slices, including actual browser and workflow checks, and record source and
isocan versions. ⚑ Canvas creation/access and CI credentials wait for the owner;
no model spend is proposed. Synthetic transport proof does not establish a
deployed integration.

## Deliberately open

- Lived-in requires seven scheduled nights on the selected project with coverage and retries recorded. The first successful connection does not establish sustained use.

- **Settled for the initial adapter, 2026-10-08:** the inspected public isocan
  CLI at `b61f7c1` has native groups but no conditional general edit. Publish
  immutable runs, with durable pending receipts and unique-match recovery;
  never treat read/check/write as CAS. The stable live pulse, atomic publication
  and remote retention remain open requirements, not silently reduced scope.
- **Settled 2026-10-08:** private home/space/audience and writer approved and used. Immutable editions retain history; automated retention remains open. No public sharing or GitHub night credentials are implied.
- **Settled 2026-10-13, by isocan `7bb1f4e` shipping `edit --if-version`:** the
  stable live pulse is a second mode beside immutable, entered only by the
  previewed `keel canvas live --yes`. A person's edit wins: a conflict is
  recorded and stays refused until the owner runs `keel canvas rebase --onto
  <version-id> --yes`; keel never adopts a person's version as its base by
  itself. An older home returns the binding to immutable. Retention of the live
  card's versions is optional (`--keep`), off by default. Still open: atomic
  multi-card publication (isocan has none; not simulated) and retention of
  immutable run cards.
- Historical retros and unsupported local variants may lack usable data. Show
  coverage gaps; do not backfill invented outcomes. Settle per adapter in slice 3.

## Next action

Walk live mode on the approved canvas. ⚑ The owner decides when: install the
inspected isocan `7bb1f4e` build for the approved writer, run `keel canvas
live` (preview), then `--yes`. The approved binding's pulse receipt predates
recorded metadata, so the preview will say `unrecorded-metadata` and the first
sync will refuse: look at the pulse card in the browser, then run `keel canvas
rebase` and `keel canvas rebase --onto <version-id> --yes` once. Then one
`keel canvas sync --yes`, and confirm
in the browser that the existing pulse was updated in place and no second pulse
appeared. Then the concurrent-edit walk: edit and rename the pulse in the
browser, sync, and see the refusal, the untouched card and `keel canvas rebase`.
Record it as evidence. Until that walk the approved binding stays immutable,
and its dashboards and weekly automation are unchanged; do not request their
approval again. After it, provision the dedicated GitHub writer using the
project-canvas guide and verify night/restart behavior, including a restored
pending edit. Scheduled-use evidence (seven nights) is still owed.

## Trajectory

- **2026-10-08** — isocan already supplies native groups and versioned source/visual items. Keel's retro is read-only, so outcome tracking requires explicit reviewed capture. A canvas remains a projection; its comments never accept source work.
- **2026-10-08** — CLI inspection ruled out safe in-place updates. Immutable runs preserve human content and stop on ambiguous receipts; that mode does not satisfy the full live-pulse acceptance. The globally installed older CLI lacks native groups.
- **2026-10-08** — A fresh night checkout loses ignored sync receipts. Restore the latest trusted canvas-enabled attempt, including failed attempts, and refuse missing state; restoring only successful attempts can duplicate an interrupted write.

- **2026-10-09** — Reconciled the October 8 owner approval, live Keel and fleet Loop dashboards, durable acknowledged receipts and weekly local schedule. These prove immutable publication and interactive rendering, not conditional updates, restart recovery, or seven scheduled nights. See the reconciliation evidence.

- **2026-10-10** — The approved writer session was recoverable from the existing automation. The newer inspected CLI needed a pinned compatibility update; its general edit still has no conditional primitive. Packed recovery and a read-only deployed receipt replay now pass, without claiming stable in-place publication.

- **2026-10-13** — isocan shipped the conditional edit (`7bb1f4e`), so the live pulse stopped waiting. Inspecting it changed the design twice: with an op id the CLI skips its own stale check and its conflict reason is the same for version and metadata, so keel classifies the refusal itself; and the answer's title and properties are a later re-read, so keel records what it wrote as the next base, not what came back. A local-daemon walk found that `--version` could not name a version to re-base onto (it is keel's own flag); the flag is `--onto`. Nothing was written to a real canvas.

- **2026-10-13** — Review of PR #126 found a pulse with no way out: changed by a person after live was enabled and before its first live sync, it was refused by sync and skipped by re-base. Re-base now also adopts such a card; recording a base when live is enabled was rejected because it leaves the same edit made before the switch stranded.

- **2026-10-13** — A second review finding: adoption compared three keel properties, the title and the hashes, so a property a person added before the first live sync rode in as the base. Publication now records the pulse's full metadata and adoption compares all of it. A receipt without it is not assumed unchanged, which costs the approved binding one explicit re-base on its way to live.
