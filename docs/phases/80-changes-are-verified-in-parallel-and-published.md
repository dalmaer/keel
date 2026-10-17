---
status: planned
since: 2026-10-16
goal: G6
spec: 2
depends: [79]
note: "Specified 2026-10-16 from isocan's release-order.sh: many commits test at once, one queued publisher advances a tested ref, skipping the superseded."
evidence: []
issue: 163
---

# Changes are verified in parallel and published one at a time

## Done when

Many commits test at once, but one queued publisher advances a tested ref (`green` by default) only for the newest commit whose gate passed, skips any commit a later one has already passed, and refuses a ref that has diverged; deploys follow the tested ref, never `main`; and every installed workflow cancels superseded test runs and never cancels a deploy, which a workflow test checks.

## Scope

The design is [Delivery: a change reaches production once, checked](../research/2026-10-16-delivery.md), items 1, 2 and 6.

- **The publisher**: a `delivery` practice installs `keel-publish.yml`, started by the gate workflow finishing on `main` (`workflow_run`, success, push). One concurrency group (`publish`, queued, never cancelled) runs `scripts/keel/publish.mjs`: it moves `delivery.tested` to the commit only if that commit descends from the current tested ref and the ref is not already at or past it; a superseded commit is skipped, a diverged ref fails red. It never writes `main`.
- **Deploys follow it**: the practice documents and checks that a project's deploy triggers on the tested ref (a push to `green`, as isocan's Cloud Build does) or on the publisher finishing; ledger's direct deploy-on-push becomes deploy-on-publish.
- **Concurrency rules as a check**: a `delivery` check in keel's workflow lint: test and gate workflows have a per-ref group with `cancel-in-progress: true`; publish and deploy workflows have a fixed group with `cancel-in-progress: false`. isocan's `workflows.test.ts` is the model.
- **Configuration**: `delivery.tested` (ref name), `delivery.gateWorkflow` (defaults to the project's gate workflow).

## Acceptance

- [ ] The publisher moves the tested ref to a newer passing descendant, skips a superseded commit, and fails on a diverged ref, without writing main. `tests/publish.test.mjs`
- [ ] Two passing commits arriving out of order leave the tested ref at the newer one. `tests/publish.test.mjs`
- [ ] The installed workflow runs only after a successful gate on main and is queued, never cancelled. `tests/workflows.test.mjs`
- [ ] The concurrency check flags a test workflow without cancel-superseded and a deploy workflow that can be cancelled. `tests/workflows.test.mjs`
- [ ] ⚑ by hand: the owner pushes two changes to one project in a row and sees one publish of the newer, the older skipped.

## Your part

- **Ask:** Push two small changes to one project a minute apart and watch its Actions page.
- **Why:** It is the owner's original complaint: two changes, one expensive publish.
- **Look at:** the project's keel-publish runs.
- **Choices:** One publish, the older skipped | Two publishes
- **Takes:** 10 minutes.
- **Then:** Two: the publisher's skip rule is wrong and is fixed.
- **Ready when:** this phase has shipped to one project.

## Real surfaces

- Workflow shell: `keel-publish` on a project.
- GitHub API: the tested ref moving.
- Adopted project: isocan and ledger, each with its own deploy following the tested ref.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/publish.test.mjs tests/workflows.test.mjs`; `npm run check`.
By hand: the owner's two pushes.

## Deliberately open

- **A merge queue** instead of a tested ref: a project may add one; keel does not require it.
- **Known limit**: the publisher batches by "newest passing wins"; it does not combine untested commits into one test run (phase 83 does, for agent sessions).

## Next action

Write `publish.mjs` (move, skip, refuse) with `tests/publish.test.mjs` on a bare-origin fixture, then the workflow.
