---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [90, 91, 96]
note: "Authorized web workspace sequence; acceptance remains unverified."
evidence: []
---

# Decisions change the reviewed source

## Done when

An owner can review and record a decision against exact current source facts and recover its operation receipt without accepting recommendations or duplicating uncertain writes.

## Scope

Add decision detail, typed preview/apply operations, source digest checks, project lock and durable receipts. Reuse decision context/shaping and existing proposal delivery policies. Public outbound material has its own exact preview.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Accepted choices and recommendations remain distinct and decision previews name exact consequences: `tests/web-decisions.test.mjs`.
- [ ] Stale digest, concurrent mutation, lost access and replay cannot change a different record: `tests/web-operations.test.mjs`.
- [ ] Uncertain remote writes recover their original operation without a duplicate issue/PR: `tests/web-operations.test.mjs`.
- [ ] ⚑ By hand: record one real decision and locate the exact source change and receipt: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- GitHub API: submit only an explicitly selected real decision and verify the receipt.
- Owner's machine: review the consequence, submit and inspect resulting source in the browser.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-decisions.test.mjs tests/web-operations.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Merging, launching agents and changing budgets remain separate authorized operations.

## Next action

Implement decision preview and bounded operation dispatch before enabling submission.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Real use

**Ask:** Record one real decision and locate the exact source change and receipt.

**Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

**Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

**Choices:** Verified | Needs changes | Cannot check yet

**Keeps it open:** Needs changes | Cannot check yet

**Takes:** One setup or testing session; record the actual duration.

**Then:** Record exactly what was observed; keep missing checks open and name the next action.

**Ready when:** Automated proof passes and the approved service exposes this phase's feature.
