---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [92, 97]
note: "Authorized web workspace sequence; acceptance remains unverified."
evidence: []
---

# Guided walks preserve what was tested

## Done when

An owner can test an exact result step by step, resume private observations and explicitly accept a successful walk while failed, blocked or stale tests leave acceptance open.

## Scope

Build the authored stepper, revision/environment display, pass/fail/blocked observations, durable drafts, source-bound final preview and feedback linkage. Reuse phase 92 immutable feedback and recovery; do not build another raw feedback store.

Contract: [Private workspace, public Plates application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Step drafts survive reload and bind observations to stable step IDs, revision and environment: `tests/web-walks.test.mjs`.
- [ ] Failed, blocked, incomplete, changed-source and changed-result walks cannot accept a phase: `tests/web-walks.test.mjs`.
- [ ] Explicit successful submission updates only the selected acceptance item and retains receipt/history: `tests/web-walks.test.mjs`.
- [ ] ⚑ By hand: owner tests a real addition, records a failure or blocked result, then completes a successful current walk: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- Owner's machine: real browser stepper with refresh, source change and success/failure observations.
- GitHub API: verify approved source write and feedback follow-up identity.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-walks.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

Do not generate expected results and pretend they were observed. Automated captures supplement a human walk.

## Next action

Verify phase 92 feedback contract, then implement private draft and outcome handling before acceptance writes.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

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
