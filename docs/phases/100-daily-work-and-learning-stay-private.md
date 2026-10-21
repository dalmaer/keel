---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [97, 98, 99]
note: "Authorized web workspace sequence; acceptance remains unverified."
evidence: []
---

# Daily work and learning stay private

## Done when

The owner can inspect daily work and shared lessons, migrate selected workspace records and explicitly export approved material while retaining project authority and existing budgets.

## Scope

Implement morning/night read and draft views, learning catalogue, setup diagnostics and previewed workspace migration. Use the command inventory for staged capability delivery; CLI/link-out remains available for advanced operations. Shared private lessons retain provenance; publishing an anonymized reusable lesson is an explicit export.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Daily views preserve configured budgets, coverage, unavailable runners and existing receipts: `tests/web-daily.test.mjs`.
- [ ] Migration previews destinations, reads replacements back and preserves originals on failure: `tests/web-migration.test.mjs`.
- [ ] Private lessons and feedback never enter public export without exact approved selection: `tests/web-learning.test.mjs`.
- [ ] ⚑ By hand: compare a real morning to its sources and migrate selected workspace data with recovery verified: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- Owner's machine: walk migration and recovery against selected real workspace records.
- GitHub API: compare actual nightly records and the approved private lesson destination.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-daily.test.mjs tests/web-migration.test.mjs tests/web-learning.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Not every CLI verb becomes a web mutation. Agent execution and schedule/spend expansion need their existing approval and worker design.

## Next action

Ship read-only daily/learning surfaces, then implement migration and explicit export with recovery.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Real use

**Ask:** Compare a real morning to its sources and migrate selected workspace data with recovery verified.

**Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

**Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

**Choices:** Verified | Needs changes | Cannot check yet

**Keeps it open:** Needs changes | Cannot check yet

**Takes:** One setup or testing session; record the actual duration.

**Then:** Record exactly what was observed; keep missing checks open and name the next action.

**Ready when:** Automated proof passes and the approved service exposes this phase's feature.
