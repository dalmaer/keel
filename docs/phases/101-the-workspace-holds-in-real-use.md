---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [100]
note: "Authorized web workspace sequence; acceptance remains unverified."
evidence: []
---

# The workspace holds in real use

## Done when

The owner repeatedly uses the hosted workspace across real projects and a restore exercise preserves private records and access boundaries without falsely completing work.

## Scope

Run the full human acceptance journey and backup/restore drill on the approved deployment; measure actual usefulness, verify revocation and preserve unresolved receipts. Record deployment, production verification and lived-in observations separately.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Deployment health names the serving revision and denies access after revocation: `tests/web-deployment.test.mjs`.
- [ ] Restore expires sessions and reconciles uncertain operations without replaying them blindly: `tests/web-restore.test.mjs`.
- [ ] ⚑ By hand: owner completes decisions, failed/successful walks and visual discovery across selected real projects: `docs/guide/web-workspace-setup.md`.
- [ ] ⚑ By hand: restore actual private workspace backup and inspect source/receipt/artifact coverage over a named observation window: `docs/guide/web-workspace-setup.md`.

## Real surfaces

- Fleet over time: dated owner observations across selected projects; no synthetic substitute.
- Owner's machine: mobile/desktop acceptance and restore drill.
- GitHub API: verify serving/source revision and revoked repository access.

## Proof

Named test paths are implementation targets until this phase is built, not
claims of existing checks or passing results.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-deployment.test.mjs tests/web-restore.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

A merge or green test suite does not establish production verification or lived-in use. The owner chooses the observation window before it starts.

## Next action

Agree the named real-use observation window and run the acceptance/restore worksheet after phase 100.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Real use

- **Ask:** Owner completes decisions, failed/successful walks and visual discovery across selected real projects.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.

### 2. Real use

- **Ask:** Restore actual private workspace backup and inspect source/receipt/artifact coverage over a named observation window.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
