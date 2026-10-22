---
status: partial
owes: walk
since: 2026-10-21
goal: G7
spec: 2
depends: [97, 102, 103]
note: "Durable worker, budget, recovery and schedule-source paths pass local proof; hosted activation and owner workflow/schedule exercises remain."
evidence: ["evidence/2026-10-21-web-workers.md"]
---

# Web operations run through durable workers

## Done when

The owner can start, cancel, retry and manage supported routines from the web with durable receipts, bounded budgets and no duplicate effects after disconnect or worker failure.

## Scope

Introduce a typed operation registry and approved worker adapters, reusing existing schedules. Implement preview, project/ref validation, atomic reservations, fenced leases, dispatch recovery and source reconciliation. Browser and Vercel request lifetimes cannot own a long job.

Contract: [Durable workers](../specs/web-workers.md), [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [x] Duplicate dispatch, worker loss, revoked permissions and stale previews cannot create competing work or cross-project credential access: `tests/web-jobs.test.mjs`.
- [x] Cancel requests, linked retries and schedule edits retain source semantics, budget bounds and uncertain outcomes: `tests/web-routine-actions.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Workflow shell: dispatch and reconcile an approved real routine, then verify cancellation/retry and duplicate request behavior.
- GitHub API: review an approved exact cron change on an existing scheduled workflow, preserve unrelated bytes and verify its actual source budget/overlap behavior.

## Proof

Local checks below are implemented. They do not establish the real-surface exercise.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-jobs.test.mjs tests/web-routine-actions.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Settled 2026-10-21 by local workflow inspection and the dated provider contract:
use the existing contributor typecheck workflow as the first fixed-command
GitHub/OIDC adapter. Local runners and provider-secret injection remain open;
no paid runner, broader App permission or workflow execution is approved by this
plan. See the worker contract for exact activation and budget boundaries.

## Next action

Obtain the selected Actions-write permission, private worker registration,
migration 009 proof, callback binding and bounded runtime allowance before
activation. Verify hosted independent-connection reservations and restore
reconciliation, then perform the owner workflow-shell and separate existing
schedule exercises in the evidence. Keep effects disabled until those bindings
are verified; no real dispatch or schedule change has run.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.
- **2026-10-21** — Managed night files are generator-owned, so direct cron edits would be overwritten. The schedule editor accepts a separate project-owned canonical typecheck source; this repo's no-cron workflow cannot prove that real surface. See the worker contract.
- **2026-10-21** — SQL three-valued logic admitted incomplete provider observations and null worker results. Independent isolated PostgreSQL probes failed before required-field corrections, then passed; unknown provider state cannot release a lane.
- **2026-10-21** — Browser retry left preceding controls bound to the new request, and terminal projection erased a known worker claim. Reproduced regressions now replace the active receipt and preserve unavailable worker results; the conductor rewalked both corrections.

## Your part

- **Ask:** Run and inspect one approved routine, exercise recovery, and review the exact worker permissions and schedule budget before enabling changes.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
