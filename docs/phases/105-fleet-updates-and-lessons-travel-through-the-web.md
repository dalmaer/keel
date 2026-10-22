---
status: designed
since: 2026-10-21
goal: G7
spec: 2
depends: [100, 104]
note: "Dedicated preparation worker, reviewed publication and source-backed lesson trace are specified; implementation remains."
evidence: []
---

# Fleet updates and lessons travel through the web

## Done when

The owner can compare fleet versions, preview and launch selected update PRs, and trace a lesson from its source through release to observed project adoption.

## Scope

Reuse fleet/update/learn domain behavior. Separate CLI, practice, lock and deployed app versions. Provide bounded rollout, canary selection, per-project failure recovery, lesson provenance and exact private/public export previews.

Contract: [Update and lesson propagation](../specs/web-fleet-updates.md),
[Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Stale refs, custom files and partial rollout preserve source ownership and recover existing update PRs without duplicate creation: `tests/web-fleet-updates.test.mjs`.
- [ ] Lesson decisions, release and observed adoption remain distinct and private content cannot enter public export implicitly: `tests/web-lesson-rollout.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- GitHub API: compare version reads and create approved update PRs on selected testable projects, retaining source and resulting PR receipts.
- Workflow shell: run the fixed update preparation worker with isolated setup/checks, verify termination and retain the exact reviewed patch.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-fleet-updates.test.mjs tests/web-lesson-rollout.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Settled 2026-10-21 by source review: use one dedicated preparation worker, sharing CLI transformation logic, followed by a separately reviewed server publication. Preserve setup ordering and checks; do not substitute an unchecked source-only draft PR. See the update contract. Merge and rollback remain separate explicit operations; an update PR alone cannot establish installation or acceptance.

## Next action

Implement the shared preparation stage and isolated worker, durable publication/rollout store, source-backed version and lesson projections, and responsive journeys. Then run named checks and the approved adopted-project real-surface exercise.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

- **2026-10-21** — The existing CLI publisher is not a durable multi-effect protocol, and typecheck cannot prepare updates. Research selected one bounded preparation worker plus separately approved publication. Setup precedes transformations; project commands need container isolation and independently confirmed cleanup. See the update contract.

## Your part

- **Ask:** Review a fleet lesson and preview an update; launch an approved selected-project rollout and verify its PR and subsequently observed version.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
