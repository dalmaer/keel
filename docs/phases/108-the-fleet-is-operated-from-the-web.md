---
status: partial
owes: walk
since: 2026-10-22
goal: G7
spec: 2
depends: [101, 107]
note: "Fleet restore/reconnect matrix and fresh feature assertions locally proven; real fleet operation and owner-selected window remain."
evidence: ["evidence/2026-10-22-web-fleet-recovery.md"]
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

- [x] Restore and reconnect reconcile pending runs, reservations and update intents without replaying external effects: `tests/web-fleet-recovery.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/guide/web-fleet-trial.md`.

## Real surfaces

- Fleet over time: record dated real fleet operations and unresolved gaps across the owner-selected observation window.

## Proof

The named matrix has local evidence. Live provider behavior, hosted backup
coverage and repeated owner operation remain separate real-surface checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-fleet-recovery.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

The owner selects participants and observation duration; automated tests or one successful session cannot establish lived-in usefulness.

## Next action

Owner selects fleet projects, participants/devices, private evidence and backup
destinations, and the observation window. Complete hosted activation and the
[private operating worksheet](../guide/web-fleet-trial.md), recording actual
receipts, source coverage, costs, failure recovery and every terminal detour.

## Trajectory

- **2026-10-22** — Global reopening could reuse feature assertions from before a restore, while disabling model execution prevented original-response readback. New effects now require current assertions; original-ID reconciliation retains independent credential gates. [Local matrix and review correction](../evidence/2026-10-22-web-fleet-recovery.md).

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

## Your part

- **Ask:** Choose the fleet and trial window, then operate it on mobile and desktop and review the recorded gaps, recovery results and actual costs.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Private operating worksheet](../guide/web-fleet-trial.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
