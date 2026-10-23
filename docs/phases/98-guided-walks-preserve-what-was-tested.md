---
status: partial
owes: walk
since: 2026-10-21
goal: G7
spec: 2
depends: [92, 97]
note: "Guided walks, private drafts and exact acceptance previews verified locally; hosted migrations, approved source delivery and real owner walk remain."
evidence: ["evidence/2026-10-21-web-guided-walks.md"]
---

# Guided walks preserve what was tested

## Done when

An owner can test an exact result step by step, resume private observations and explicitly accept a successful walk while failed, blocked or stale tests leave acceptance open.

## Scope

Build the authored stepper, revision/environment display, pass/fail/blocked observations, durable drafts, source-bound final preview and feedback linkage. Reuse phase 92 immutable feedback and recovery; do not build another raw feedback store.

Implementation: [Hosted guided walks](../specs/web-guided-walks.md).

Contract: [Private workspace, public Plates application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [x] Step drafts survive reload and bind observations to stable step IDs, revision and environment: `tests/web-walks.test.mjs`.
- [x] Failed, blocked, incomplete, changed-source and changed-result walks cannot accept a phase: `tests/web-walks.test.mjs`.
- [x] Explicit successful submission updates only the selected acceptance item and retains receipt/history: `tests/web-walks.test.mjs`.
- [ ] ⚑ By hand: owner tests a real addition, records a failure or blocked result, then completes a successful current walk: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- Owner's machine: real browser stepper with refresh, source change and success/failure observations.
- GitHub API: verify approved source write and feedback follow-up identity.

## Proof

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-walks.test.mjs`
- `node --import ./tests/helpers/hermetic.mjs --test tests/web-walk-operations.test.mjs tests/web-walk-ui.test.mjs tests/web-server.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Do not generate expected results and pretend they were observed. Automated captures supplement a human walk.

## Next action

Use the fresh owner-supplied Vercel authentication code to finish approved hosted migrations 004/005 and their role/concurrency proof, then deploy and walk a real authored result. Keep source submission disabled until separate Contents-write approval and the instance opt-in. Follow the owner steps in the evidence; synthetic observations are not that walk.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.
- **2026-10-21** — Returning to an old build, environment, instruction or acceptance target cannot revive earlier passes. Monotonic invalidation and prerequisite observation digests retain historical evidence while requiring fresh current observations; unchanged saves and display-only reorder preserve valid results.
- **2026-10-21** — Draft mutation and source acceptance share the existing project reservation. Apply reserves before validating the draft, then commits and recovers the bounded phase/evidence/roadmap set through one conditional GitHub mutation. Hosted concurrency and actual owner delivery remain separate proof.

## Your part

### 1. Real use

- **Ask:** Owner tests a real addition, records a failure or blocked result, then completes a successful current walk.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
