---
status: planned
since: 2026-10-23
goal: G2
spec: 2
depends: [124]
note: "Specified 2026-10-23 (docs/specs/name-transition.md). Branches and concurrency groups: plates writes plates-night/ and friends and reads both prefixes as one queue, so in-flight keel-night/ PRs and tonight's keel-night-plan keep working. #218 (finalize drops what it did not write) is fixed first, in the same code."
evidence: []
issue: 241
---

# Night, climb, tend, loop, robot, update and verify branches are written as plates and read under both names

## Done when

Plates writes `plates-night/<date>`, `plates-night/<date>-final`, `plates-night-plan` (blob `.plates/night/plan.json`), `plates-climb/`, `plates-tend/`, `plates-loop/`, `plates/robot-*`, `plates/update-*` and `plates-verify`, with concurrency groups `plates-…`. Every reader treats the keel and plates prefixes as one queue. A night already open under `keel-night/<date>` finishes there.

## Scope

The design is [Name transition](../specs/name-transition.md), "Hazards".

- **First, #218.** The finalize step rewrites the health page without the production-monitoring lines and the `keel:health-report:end` marker it did not write. Fix it, with its regression test, before the prefix changes, because both touch `plates-morning.yml` and `morning.mjs`.
- **Writers** (the table rows in phase 124 go from `held` to `dual`):
  - `plates-night.yml` and `plates-morning.yml` (the night and final PRs);
  - `night-plan.mjs` and `goodnight` (the plan branch and its blob path);
  - `plates-climb.yml` and `plates-robot.yml`;
  - tend, loop and update;
  - `verify.mjs --record`.
- **Readers** match both prefixes:
  - `drain.mjs`, as one queue, newest passing first, whatever the prefix;
  - morning's decide, finalize and send;
  - the board, loose-ends and fleet;
  - `lib/web` (run views, daily, the night-retry sources);
  - `canvas-recovery.mjs`, `improve.mjs`, `test-ledger.mjs`, `test-history.mjs` and `verification.mjs`.
- **A night keeps its name.** `-final` follows the branch its own night opened (`keel-night/<date>` → `keel-night/<date>-final`). Only a new date opens under `plates-`.
- **One plan per night.** Goodnight writes only `plates-night-plan`. The night reads `plates-night-plan` first, and `keel-night-plan` only when the plates branch has no plan dated tonight. If both are dated tonight, the plates plan wins, and the night's record says so.
- **Verify history:** the board and morning read `plates-verify` first and fall back to `keel-verify`. The newest result per site wins across both.
- **Concurrency groups** `keel-…` → `plates-…` in all inventoried workflows, in one release. Different refs have independent leases, so the repository rollout must first disable affected workflows with owner approval, keep that schedule/dispatch barrier through installation, and drain old runs or observe confirmed cancellation. The read-only rollout preflight blocks the switch for queued, waiting, pending or running old-group runs, and for incomplete coverage. Phase 128 exposes this preflight and phase 129 records it before installing changed workflows; no new dispatch before it passes.

## Acceptance

- [ ] #218 is fixed: a health page's lines outside the plan table survive finalize byte for byte. `tests/morning.test.mjs`: "finalize keeps the sections it did not write"
- [ ] A fresh project's night, final, plan, climb, tend, loop, robot, update and verify writes use only plates names. `tests/night-box.test.mjs`: "a new project's whole night writes no keel name"
- [ ] An upgraded project with an open `keel-night/<date>` PR and a `keel-night-plan` dated tonight runs that plan. Its `-final` lands on `keel-night/<date>-final`, and drain merges both prefixes' PRs as one queue. `tests/night-box.test.mjs`: "a night started under keel's names finishes under them, and drains with plates's"
- [ ] Both plan branches dated tonight: the plates plan runs, and the record names the one it skipped. `tests/night-plan.test.mjs`: "two plans for one night: plates wins, and says so"
- [ ] The board and morning show a failed verify from `keel-verify` until a newer result on `plates-verify` passes. `tests/board.test.mjs` and `tests/morning.test.mjs`: "verify history across both branches"
- [ ] Every workflow's concurrency group is `plates-…`. `tests/workflows.test.mjs`: "no workflow groups under a keel name"

- [ ] A live old-group run blocks a concurrency-name switch across both branch prefixes; completed cancellation permits it, requested cancellation and incomplete run coverage do not. `tests/workflows.test.mjs`: "old-group runs block the concurrency transition"

## Real surfaces

- workflow shell: the night, morning, climb and robot workflows, run by `workflow_dispatch` on plates and then each fleet project in phase 129.
- GitHub API: branch and PR prefixes read through `gh` in drain, morning and the board.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/night-box.test.mjs tests/night-plan.test.mjs tests/morning.test.mjs tests/board.test.mjs tests/workflows.test.mjs`; `npm run check`. Mutation-check each dual reader: make it read only one prefix, and see its test go red. Record that in the evidence.
By hand: phase 129's dispatched nights.

## Deliberately open

- **Robot branches** `keel/robot-*` include an issue number. A robot PR open across the switch keeps its branch, and a new attempt on the same issue opens `plates/robot-*`. The robot's subject reservation (#216's open finding, robot-issue.mjs:273) must count both, or the issue is held forever.

## Next action

Fix #218 with its regression test, then switch the night and final rows in the phase-124 table to `dual`. Before merging changed active workflows into plates itself, obtain the owner-approved disable/drain barrier: merging the self-rendered workflow is already an installation, not a step that can wait until phase 129. If that approval is pending, retain the reviewed PR; do not bypass the barrier to cut a release.
