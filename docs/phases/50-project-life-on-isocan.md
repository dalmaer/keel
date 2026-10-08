---
status: designed
since: 2026-10-08
goal: G5
spec: 2
depends: [2, 10, 26, 40]
note: "Integration specified: one project canvas projects the whole lifecycle with source-backed improvement measures. Implementation and the real isocan walk remain."
evidence: []
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

- [ ] All lifecycle sources, both phase shapes, stable identities and unknown coverage are normalized without inventing facts: `tests/canvas-snapshot.test.mjs` (to be implemented).
- [ ] Metrics distinguish fixes, declined/stale findings, acceptance, merge, production verification and lived-in evidence; source links and accessible filters work: `tests/canvas-render.test.mjs` (to be implemented).
- [ ] Connect, sync, retry and recovery preserve stable item ids and human edits, with no blind retries after ambiguous creation: `tests/canvas-sync.test.mjs` (to be implemented).
- [ ] Retro capture is explicit, reviewed and redacted; owner choices remain authoritative and unsupported providers remain unknown: `tests/canvas-retro.test.mjs` (to be implemented).
- [ ] The existing night publishes its measured snapshot without repeating the gate or invoking a model: `tests/canvas-night.test.mjs` (to be implemented).
- [ ] CLI help, optional practice installation/migration and the packed CLI agree: `npm run check`.
- [ ] ⚑ by hand: owner approves home, space, audience and writer access; conductor performs the real isocan walk in spec slice 5, including concurrent-edit protection and restart recovery, and records evidence.

## Real surfaces

- Owner's machine: installed isocan creates and updates a private canvas; verify native groups, visual/source faces, source links, identity and conflicts in the browser.
- Published package: pack and install Keel, connect and render from a fresh adopted project without importing isocan's SDK.
- Workflow shell: opt-in night uses actual credentials and one-writer configuration; prove offline/auth-expiry/interrupted-write behavior.
- GitHub API: compare observed PR merge and CI facts with source phase acceptance, including a merged-but-unaccepted example.
- Adopted project: follow Loop, lesson and retro outcomes to real evidence in the source records; edited cards and human notes survive a sync.

## Proof

Implementation commands (tests are not built yet):

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/canvas-snapshot.test.mjs tests/canvas-render.test.mjs tests/canvas-sync.test.mjs tests/canvas-retro.test.mjs tests/canvas-night.test.mjs
npm run check
```

Use the test ledger reporter for focused runs as well. Execute the spec's five
slices, including actual browser and workflow checks, and record source and
isocan versions. ⚑ Canvas creation/access and CI credentials wait for the owner;
no model spend is proposed. The spec is a plan, not evidence of integration.

## Deliberately open

- Lived-in requires seven scheduled nights on the selected project with coverage and retries recorded. The first successful connection does not establish sustained use.

- Conditional writes and idempotent creation are not verified against deployed
  isocan. Prove them in slice 2; otherwise immutable runs are an explicitly
  limited mode and unattended live-pulse acceptance remains incomplete.
- Choose home/space/audience and retention in the owner walk. Do not assume
  public sharing, credentials, quota or unlimited remote snapshot history.
- Historical retros and unsupported local variants may lack usable data. Show
  coverage gaps; do not backfill invented outcomes. Settle per adapter in slice 3.

## Next action

Build the local snapshot schema and collectors from spec slice 1, with Acme
fixtures covering all lifecycle rows and the four independent delivery facts.

## Trajectory

- **2026-10-08** — isocan already supplies native groups and versioned source/visual items. Keel's retro is read-only, so outcome tracking requires explicit reviewed capture. A canvas remains a projection; its comments never accept source work.
