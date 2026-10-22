---
status: partial
owes: walk
since: 2026-10-22
goal: G7
spec: 2
depends: [100]
note: "Serving identity, permanent auth epoch and restore quarantine locally proven; hosted owner use and actual backup drill remain."
evidence: ["evidence/2026-10-22-web-restore.md"]
---

# The workspace holds in real use

## Done when

The owner repeatedly uses the hosted workspace across real projects and a restore exercise preserves private records and access boundaries without falsely completing work.

## Scope

This phase verifies the first decision/testing workspace. Phase 108 verifies the expanded fleet operating goal; this acceptance cannot stand in for routine execution or routing proof.

Restore private Git records, transactional database records and private media separately, expiring restored sessions. Run the full human acceptance journey and backup/restore drill on the approved deployment; measure actual usefulness, verify revocation and preserve unresolved receipts. Record deployment, production verification and lived-in observations separately.

Contract: [Private workspace, public Plates application](../specs/web-workspace.md),
[UX](../specs/web-ui.md), [CLI mapping](../specs/web-ui-command-map.md) and
[restore verification](../specs/web-restore.md).

## Acceptance

- [x] Deployment health names the serving revision and denies access after revocation: `tests/web-deployment.test.mjs`.
- [x] Restore expires sessions and reconciles uncertain operations without replaying them blindly: `tests/web-restore.test.mjs`.
- [ ] ⚑ By hand: owner completes decisions, failed/successful walks and visual discovery across selected real projects: `docs/guide/web-recovery.md`.
- [ ] ⚑ By hand: restore actual private workspace backup and inspect source/receipt/artifact coverage over a named observation window: `docs/guide/web-recovery.md`.

## Real surfaces

- Fleet over time: dated owner observations across selected projects; no synthetic substitute.
- Owner's machine: mobile/desktop acceptance and restore drill.
- GitHub API: verify serving/source revision and revoked repository access.

## Proof

Named service tests and actual-SQL proof have local evidence. Hosted serving
identity, backup completeness and physical-device use remain separate checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-deployment.test.mjs tests/web-restore.test.mjs`
- `npm run check`
- `npm run typecheck`
- Walk the named real surfaces; retain exact commands, exit codes, source revisions and observed outcomes in dated evidence.

## Deliberately open

A merge or green test suite does not establish production verification or lived-in use. The owner chooses the observation window before it starts.

## Next action

Owner selects a private backup destination, isolated restore target, projects,
participants and observation window. Deploy the verified application, compare
serving identity, then complete the decision/testing/visual and restore journeys
in the [private trial worksheet](../guide/web-recovery.md). Keep execution
features disabled until their separate current restore proofs hold.

## Trajectory

- **2026-10-22** — A snapshot can predate external dispatch; even a receipt GET can mutate recovered state. A fresh deployment epoch fences restored authorization, and quarantine covers every business route until an explicit operator audit. [Local proof](../evidence/2026-10-22-web-restore.md).

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.

## Your part

### 1. Real use

- **Ask:** Owner completes decisions, failed/successful walks and visual discovery across selected real projects.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Private trial worksheet](../guide/web-recovery.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.

### 2. Real use

- **Ask:** Restore actual private workspace backup and inspect source/receipt/artifact coverage over a named observation window.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Private trial worksheet](../guide/web-recovery.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
