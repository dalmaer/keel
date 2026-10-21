---
status: designed
since: 2026-10-21
goal: G7
spec: 2
depends: [96]
note: "Read adapters, bounded coverage, actor-scoped receipts and responsive history are specified; implementation and hosted walks remain."
evidence: []
---

# Routines have a complete observed history

## Done when

The owner can inspect routine definitions and all observed attempts across authorized projects, with source coverage, outcomes, evidence and costs visible in both fleet and project views.

## Scope

Normalize existing workflow, night, CLI and web receipts into one source-linked run model. Add bounded backfill, deduplication, stage detail, artifact links and retention coverage. Read-only first; controls wait for phase 104.

Contract: [Fleet operations](../specs/web-fleet-operations.md),
[routine history](../specs/web-routine-history.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Run identities retain retries and parentage, deduplicate dispatch/source records, and distinguish execution success from acceptance: `tests/web-runs.test.mjs`.
- [ ] Expired artifacts, disconnected runners, missing history and unknown costs stay visible instead of becoming empty success: `tests/web-run-coverage.test.mjs`.
- [ ] Private operation listings stay actor/project scoped, disclose missing storage and preserve original recovery: `tests/web-run-receipts.test.mjs`.
- [ ] Fleet/project routes preserve filters and expose stages and coverage on mobile and desktop: `tests/web-runs-ui.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- GitHub API: compare the feed with real selected workflow runs and attempts, including a failed or skipped run.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-runs.test.mjs tests/web-run-coverage.test.mjs`
- `node --import ./tests/helpers/hermetic.mjs --test tests/web-run-receipts.test.mjs tests/web-runs-ui.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Settled 21 October 2026 by source inventory and the routine-history contract:
on-demand bounded pages over retained sources, no persistent run mirror; a
30-day default visible window never hides the gap for older unvisited reruns.
Local CLI reporting remains unavailable until an authenticated worker bridge in
phase104. Historical unrecorded runs cannot be recovered. Actions-read approval,
hosted read-RPC activation and the real owner walk remain open.

## Next action

Build the specified read adapters, private receipt listing and fleet/project UI;
verify actual GitHub sources and browser behavior before hosted activation.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.
- **2026-10-21** — Existing Actions usage code already accounts for reruns of old logical runs; the web reader must not introduce a created-at lower filter. Existing web operations have no observed start timestamp or list RPC, so history adds a scoped read projection and labels inferred times.

## Your part

- **Ask:** Compare a real routine and its retry from a phone and desktop; identify its result, evidence, cost and missing coverage.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
