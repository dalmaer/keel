---
status: partial
owes: walk
since: 2026-10-22
goal: G7
spec: 2
depends: [98, 99, 105, 106]
note: "Coverage, scoped navigation, private drafts and bounded night adapters pass local proof; hosted activation, browser interactions and owner devices remain unverified."
evidence: ["evidence/2026-10-22-web-operations.md"]
---

# Mobile and desktop cover Keel operations

## Done when

Every current Keel operation has a deliberate web treatment, and core fleet/project journeys work on mobile and desktop without a terminal detour.

## Scope

Reaudit public commands, arguments and installed routines against a shared capability registry. Finish native workflows and supported worker/local bridges. Verify project-lens switching, accessible controls, deep links, drafts and reconnect without unsafe mutation replay.

Contract: [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md), [CLI mapping](../specs/web-ui-command-map.md)
and [operation experience](../specs/web-operation-experience.md).

## Acceptance

- [x] Every public operation and argument has a native, worker, presentation-only or explicitly limited treatment with follow-up: `tests/web-operation-coverage.test.mjs`.
- [x] Fleet/project routing, draft persistence, session expiry, keyboard navigation and narrow layouts preserve capability and action scope: `tests/web-responsive.test.mjs`, `tests/web-editor-drafts.test.mjs` and `tests/web-recovery.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Owner's machine: complete the same end-to-end operating tasks in real mobile and desktop browsers, including offline reconnect and expired session.

## Proof

The operation-experience spec separates coverage from execution. The bounded
night adapters need their own proof; the typecheck worker cannot substitute for a
failed-night retry. Local database proof uses the retained scripts below with
`KEEL_SQL_PROOF_MODULE` pointing to a separately installed PGlite module. It does
not establish hosted independent-connection behavior.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-operation-coverage.test.mjs tests/web-responsive.test.mjs tests/web-editor-drafts.test.mjs tests/web-recovery.test.mjs tests/web-night-plan.test.mjs tests/web-night-retry.test.mjs tests/web-night-retry-migrations.test.mjs tests/web-night-ui.test.mjs`
- `node docs/evidence/2026-10-22-editor-drafts-sql-proof.mjs`
- `node docs/evidence/2026-10-22-night-plan-sql-proof.mjs`
- `node docs/evidence/2026-10-22-night-retry-sql-proof.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Local-only operations may require an authorized runner; unsupported capabilities stay visible and cannot count as complete core journeys.

Settled 2026-10-22: preserve the existing domain execution adapters; catalogue
coverage does not establish execution. Save typed daily/model editor drafts in a
separate encrypted CAS store, with explicit expiry and activation approval.
Offline unsaved edits remain in memory; no private browser persistence is added.

## Next action

Complete the hosted activation and database concurrency checks for each approved
feature, deploy the checked revision, then finish the blocked browser interaction
walk and the owner’s mobile/desktop exercise. Use the dated evidence’s checklist.
Keep unregistered night workflows and unsupported local/model execution visible;
only the registered canonical retry adapter can satisfy the night-recovery trial.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

- **2026-10-22** — Native night retry retains original GitHub privileges but reads the current date/plan. Exact private source profiles, shared admission and conservative uncertain receipts replace an unsafe promise of immutable replay. Conditional plan publication retains a disclosed cross-branch policy race. See dated evidence.
- **2026-10-22** — Review reproduced stale-budget admission and migration reapplication bypasses. Fresh allowances now govern send; SQL013 preserves its delegate, while 009/010 refuse after it. Single-connection actual SQL proves these transitions; hosted concurrency remains owed.

## Your part

- **Ask:** Use a phone and desktop to investigate a run, record a test, update a project and inspect capacity; record every required terminal detour.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
