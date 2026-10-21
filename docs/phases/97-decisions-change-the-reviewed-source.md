---
status: partial
since: 2026-10-21
goal: G7
spec: 2
depends: [90, 91, 96]
note: "Typed previews and durable conditional operations verified locally; hosted migration, Contents-write approval and a real owner choice await the owner walk."
owes: walk
evidence: ["evidence/2026-10-21-web-decisions.md"]
---

# Decisions change the reviewed source

## Done when

An owner can review and record a decision against exact current source facts and recover its operation receipt without accepting recommendations or duplicating uncertain writes.

## Scope

Add decision detail, typed preview/apply operations, source digest checks, project lock and durable receipts. Reuse decision context/shaping and existing proposal delivery policies. Public outbound material has its own exact preview. Initial writers cover legacy health proposals and unanswered shaping questions; unsupported policy-bound decisions remain inspect-only. See the phase-97 delivery section in the workspace contract.

Contract: [Private workspace, public Keel application](../specs/web-workspace.md),
[UX](../specs/web-ui.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [x] Accepted choices and recommendations remain distinct and decision previews name exact consequences: `tests/web-decisions.test.mjs`.
- [x] Stale digest, concurrent mutation, lost access and replay cannot change a different record: `tests/web-operations.test.mjs`.
- [x] Uncertain remote writes recover their original operation without a duplicate commit; these two writers never create an issue/PR: `tests/web-operations.test.mjs`.
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

Settled 2026-10-21: reuse the legacy proposal transform and shaping schema, and
use a canonical immutable-reader interface for decision context. GitHub GraphQL
expectedHeadOid protects context across the whole reviewed revision. App Contents
write and the exact real owner decision remain explicit owner steps.

## Next action

PR #214 is reviewed and merged. Obtain the fresh Vercel verification code,
apply migration 004 and verify hosted roles/concurrency; deploy with submission
disabled and walk the exact preview. Then obtain Contents-write approval and a
particular owner choice before the real write/receipt walkthrough. Retain the
existing serving Home until the new deployment prerequisites pass.

## Trajectory

- **2026-10-21** — Created from the owner's request for a hosted UI with private workspace data, project-owned records, decisions, guided testing and visible recent additions.
- **2026-10-21** — Repository names can be reused after a rename, even with cloned history. Independent review reproduced false recovery; previews now pin repository/Ref identities, writes address the Ref ID, and recovery verifies the same repository by node ID. See phase evidence.

## Your part

### 1. Real use

- **Ask:** Record one real decision and locate the exact source change and receipt.

- **Why:** This needs actual owner access or observation; synthetic tests cannot establish it.

- **Look at:** [Setup worksheet](../guide/web-workspace-setup.md) and this phase's source evidence.

- **Choices:** Verified | Needs changes | Cannot check yet

- **Keeps it open:** Needs changes | Cannot check yet

- **Takes:** One setup or testing session; record the actual duration.

- **Then:** Record exactly what was observed; keep missing checks open and name the next action.

- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
