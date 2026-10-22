---
status: designed
since: 2026-10-22
goal: G7
spec: 2
depends: [101, 107]
note: "Restore/reconnect matrix and fresh feature assertions designed; implementation and real fleet trial remain."
evidence: []
---

# The fleet is operated from the web

## Done when

Repeated real use demonstrates that the owner operates the selected fleet from mobile and desktop, including routine failure recovery, updates, learning and bounded model fallback.

## Scope

Extend the initial workspace trial to the full operating goal. Observe source completeness, terminal detours, actual costs, revocation, partial rollouts, worker recovery and restore with unresolved jobs. Keep implemented, deployed, verified and lived-in claims distinct.

Contract: [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md), [CLI mapping](../specs/web-ui-command-map.md)
and [fleet recovery](../specs/web-fleet-recovery.md).

## Acceptance

- [ ] Restore and reconnect reconcile pending runs, reservations and update intents without replaying external effects: `tests/web-fleet-recovery.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Fleet over time: record dated real fleet operations and unresolved gaps across the owner-selected observation window.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-fleet-recovery.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

The owner selects participants and observation duration; automated tests or one successful session cannot establish lived-in usefulness.

## Next action

Implement and prove the serialized fleet recovery matrix and fresh per-feature
restore assertions; prepare the private operating worksheet. Owner selects the
fleet, private backup destination and real-use window before observations.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

## Your part

- **Ask:** Choose the fleet and trial window, then operate it on mobile and desktop and review the recorded gaps, recovery results and actual costs.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
