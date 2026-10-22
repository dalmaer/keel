---
status: partial
since: 2026-10-21
owes: walk
goal: G7
spec: 2
depends: [100, 104]
note: "Local code, SQL and desktop/mobile journeys are verified; real container/workflow, hosted concurrency and approved adopted-project rollout remain."
evidence: ["evidence/2026-10-21-web-fleet-updates.md"]
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

- [x] Stale refs, custom files and partial rollout preserve source ownership and recover existing update PRs without duplicate creation: `tests/web-fleet-updates.test.mjs`.
- [x] Lesson decisions, release and observed adoption remain distinct and private content cannot enter public export implicitly: `tests/web-lesson-rollout.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- GitHub API: compare version reads and create approved update PRs on selected testable projects, retaining source and resulting PR receipts.
- Workflow shell: run the fixed update preparation worker with isolated setup/checks, verify termination and retain the exact reviewed patch.

## Proof

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-fleet-updates.test.mjs tests/web-lesson-rollout.test.mjs`
- `node --import ./tests/helpers/hermetic.mjs --test tests/update.test.mjs tests/update-prepare.test.mjs tests/web-update-worker.test.mjs tests/web-fleet-updates-ui.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Settled 2026-10-21 by source review: use one dedicated preparation worker, sharing CLI transformation logic, followed by a separately reviewed server publication. Preserve setup ordering and checks; do not substitute an unchecked source-only draft PR. See the update contract. Merge and rollback remain separate explicit operations; an update PR alone cannot establish installation or acceptance.

## Next action

Walk the real isolated worker after Docker is available; select an adopted project,
exact trusted build, container/network policy and runtime allowance. With explicit
owner approval, verify migration 010 through independent hosted connections,
install the pinned workflow, enable the necessary App permissions and deploy the
existing service. Prepare and review one canary PR, recover an interrupted response,
then observe the default branch separately. No update activation or PR is approved
by the local implementation. Keel itself cannot substitute for an adopted project.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

- **2026-10-21** — The existing CLI publisher is not a durable multi-effect protocol, and typecheck cannot prepare updates. Research selected one bounded preparation worker plus separately approved publication. Setup precedes transformations; project commands need container isolation and independently confirmed cleanup. See the update contract.

- **2026-10-21** — Container tmpfs must be copied while its processes are independently confirmed frozen, before termination destroys the snapshot. The local Docker engine was unavailable, so protocol tests do not establish real isolation. See the evidence.

- **2026-10-21** — Publication advances one external effect per request to fit the host deadline. Foreground progress reuses the exact approval; uncertainty stops it for readback. Browser review also moved technical identities behind disclosures and made each step replace the previous screen. See the desktop/mobile evidence.

## Your part

- **Ask:** Review a fleet lesson and preview an update; launch an approved selected-project rollout and verify its PR and subsequently observed version.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
