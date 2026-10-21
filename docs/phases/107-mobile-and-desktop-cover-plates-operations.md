---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [98, 99, 105, 106]
note: "Expanded fleet operating goal; design and proof remain to be implemented."
evidence: []
---

# Mobile and desktop cover Plates operations

## Done when

Every current Plates operation has a deliberate web treatment, and core fleet/project journeys work on mobile and desktop without a terminal detour.

## Scope

Reaudit public commands, arguments and installed routines against a shared capability registry. Finish native workflows and supported worker/local bridges. Verify project-lens switching, accessible controls, deep links, drafts and reconnect without unsafe mutation replay.

Contract: [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Every public operation and argument has a native, worker, presentation-only or explicitly limited treatment with follow-up: `tests/web-operation-coverage.test.mjs`.
- [ ] Fleet/project routing, draft persistence, session expiry, keyboard navigation and narrow layouts preserve capability and action scope: `tests/web-responsive.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Owner's machine: complete the same end-to-end operating tasks in real mobile and desktop browsers, including offline reconnect and expired session.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-operation-coverage.test.mjs tests/web-responsive.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Local-only operations may require an authorized runner; unsupported capabilities stay visible and cannot count as complete core journeys.

## Next action

Build the executable operation-coverage matrix and identify missing core journeys before responsive acceptance.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

## Your part

- **Ask:** Use a phone and desktop to investigate a run, record a test, update a project and inspect capacity; record every required terminal detour.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
