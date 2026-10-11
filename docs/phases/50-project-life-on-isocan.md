---
status: partial
since: 2026-10-10
goal: G5
spec: 2
depends: [2, 10, 26, 40]
note: "Local collection, interactive render, reviewed retro capture and immutable sync are implemented. Approved immutable dashboards and deployed recovery replay verified; packed connection/restart proof passes. Conditional live pulse, browser concurrent-edit walk and deployed night proof remain."
evidence: ["evidence/2026-10-08-project-canvas.md", "evidence/2026-10-09-canvas-reconciliation.md", "evidence/2026-10-10-canvas-recovery.md"]
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
- [ ] Connect, sync, retry and recovery preserve stable item ids and human edits, with no blind retries after ambiguous creation: `tests/canvas-sync.test.mjs` proves the limited immutable mode; deployed concurrency and the stable live pulse remain.
- [x] Retro capture is explicit, reviewed and redacted; owner choices remain authoritative and unsupported providers remain unknown: `tests/canvas-retro.test.mjs`.
- [ ] The existing night publishes its measured snapshot without repeating the gate or invoking a model: `tests/canvas-night.test.mjs` exercises the workflow shell; the deployed credential and restart walk remains.
- [x] CLI help, optional practice installation/migration and the packed CLI agree: `npm run check`.
- [ ] ⚑ by hand: owner approves home, space, audience and writer access; conductor performs the real isocan walk in spec slice 5, including concurrent-edit protection and restart recovery, and records evidence.

## Your part

The owner approved the private destination and Keel writer on 2026-10-08;
that decision is settled and must not be asked again. Canvas
`prj_9CgFY5l-na`, private space `spc_JA2u7KSKSI`, writer `usr_FkZbi3ZGqT`.
The weekly local report task is approved and active (Monday 08:00 Denver).
GitHub night credentials and scheduled access are a separate, unprovisioned
surface; prepare its concrete setup before requesting any new credential.

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
- Historical retros and unsupported local variants may lack usable data. Show
  coverage gaps; do not backfill invented outcomes. Settle per adapter in slice 3.

## Next action

Await a deployed public isocan conditional-edit operation before implementing
the stable live pulse. Complete the real browser concurrent-edit walk and
provision the dedicated GitHub writer using the project-canvas guide, then
verify night/restart behavior. Immutable packed recovery and a deployed
historical receipt replay are proven. Preserve the already approved destination,
writer, dashboards and weekly automation; do not request their approval again.
Scheduled-use evidence is still owed.

## Trajectory

- **2026-10-08** — isocan already supplies native groups and versioned source/visual items. Keel's retro is read-only, so outcome tracking requires explicit reviewed capture. A canvas remains a projection; its comments never accept source work.
- **2026-10-08** — CLI inspection ruled out safe in-place updates. Immutable runs preserve human content and stop on ambiguous receipts; that mode does not satisfy the full live-pulse acceptance. The globally installed older CLI lacks native groups.
- **2026-10-08** — A fresh night checkout loses ignored sync receipts. Restore the latest trusted canvas-enabled attempt, including failed attempts, and refuse missing state; restoring only successful attempts can duplicate an interrupted write.

- **2026-10-09** — Reconciled the October 8 owner approval, live Keel and fleet Loop dashboards, durable acknowledged receipts and weekly local schedule. These prove immutable publication and interactive rendering, not conditional updates, restart recovery, or seven scheduled nights. See the reconciliation evidence.

- **2026-10-10** — The approved writer session was recoverable from the existing automation. The newer inspected CLI needed a pinned compatibility update; its general edit still has no conditional primitive. Packed recovery and a read-only deployed receipt replay now pass, without claiming stable in-place publication.
