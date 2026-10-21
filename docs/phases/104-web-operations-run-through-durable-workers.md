---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [97, 102, 103]
note: "Expanded fleet operating goal; design and proof remain to be implemented."
evidence: []
---

# Web operations run through durable workers

## Done when

The owner can start, cancel, retry and manage supported routines from the web with durable receipts, bounded budgets and no duplicate effects after disconnect or worker failure.

## Scope

Introduce a typed operation registry and approved worker adapters, reusing existing schedules. Implement preview, project/ref validation, atomic reservations, fenced leases, dispatch recovery and source reconciliation. Browser and Vercel request lifetimes cannot own a long job.

Contract: [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Duplicate dispatch, worker loss, revoked permissions and stale previews cannot create competing work or cross-project credential access: `tests/web-jobs.test.mjs`.
- [ ] Cancel requests, linked retries and schedule edits retain source semantics, budget bounds and uncertain outcomes: `tests/web-routine-actions.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Workflow shell: dispatch and reconcile an approved real routine, then verify cancellation/retry and duplicate request behavior.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-jobs.test.mjs tests/web-routine-actions.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Worker hosting, local runner transport and additional GitHub permissions remain explicit connection decisions; no paid runner or broader App permission is approved by this plan.

## Next action

Select the first existing workflow adapter and specify its dispatch, identity, cancellation and recovery protocol.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

## Your part

- **Ask:** Run and inspect one approved routine, exercise recovery, and review the exact worker permissions and schedule budget before enabling changes.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
