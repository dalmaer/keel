---
status: partial
since: 2026-10-16
goal: G6
spec: 2
depends: [33, 15]
note: "Partial 2026-10-16: scripts/keel/gate.mjs reuses CI's exact result (proven by its keel-test-runs records) for the night, the loop and pre-push, and skips docs-only commits; the judges' base gates still run their own."
evidence: ["evidence/2026-10-16-gate-reuse.md"]
issue: 162
---

# One gate result per commit, shared by every pass

## Done when

Each commit's gate runs once in CI and its result and test-ledger runs are kept; every keel pass (night, loop, climb, tend, robot judges) and the pre-push hook reuse an exact, clean result for the commit they would test and run the gate only when there is none; and a change that touches only documentation skips the suite.

## Scope

The design is [Delivery: a change reaches production once, checked](../research/2026-10-16-delivery.md), items 7 and 9 of "What is common".

- **Keep the result**: the gate workflow (keel's `check.yml`, or the project's `gateWorkflow`) uploads `keel-test-runs` from `.keel/test-runs` on every run, and keel's adoption proposes the step where a project keeps its own CI (ledger's missing upload is the case).
- **Reuse it**: one function, used by the night's `improve.mjs` (which already does), the loop's gate step, climb and tend and robot judges where they test the commit CI tested, and an optional pre-push helper: an exact, clean, completed, successful result for the commit within 24 hours is the gate; anything else runs it.
- **Doc-only skip**: a `delivery.docsOnly` path list (ledger's `ci-scope.mjs` generalised); a commit touching only those paths records "skipped: docs only" instead of running the suite.
- **Never weaker**: a reused result must be for the same command (`check`), the same tree, and a run that tested something (the ledger's "no test ran" rule).

## Acceptance

- [x] The gate workflow uploads `keel-test-runs` on success and failure, and adoption proposes it for a project's own CI. `tests/workflows.test.mjs`, `tests/adopt.test.mjs`
- [ ] Every pass that runs the gate reuses an exact, clean, successful result for its commit and runs the gate only without one, saying which. `tests/gate-reuse.test.mjs`
- [x] A result for another command, another tree, or a run with no tests is never reused. `tests/gate-reuse.test.mjs`
- [x] A doc-only commit records a skip, and a commit touching anything else runs the suite. `tests/gate-reuse.test.mjs`
- [ ] ⚑ by hand: the owner reads one week of keel's CI minutes before and after on the night's health page.

## Your part

- **Ask:** Read the CI-minutes line on keel's health page for the week before and the week after this ships.
- **Why:** It shows whether reusing one result per commit actually saves the runs the comparison found.
- **Look at:** the health page's CI minutes measure.
- **Choices:** Fewer minutes | No change
- **Takes:** 10 minutes.
- **Then:** No change: the passes still running the gate are found and fixed.
- **Ready when:** this phase has shipped and a week has passed.

## Real surfaces

- Workflow shell: CI's upload and every keel pass's reuse.
- Adopted project: ledger's CI proposal.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/gate-reuse.test.mjs tests/workflows.test.mjs tests/adopt.test.mjs`; `npm run check`.
By hand: the owner's week.

## Deliberately open

- **24 hours** was settled as the default window. Phase 89 (2026-10-17) adds
  an explicit `ci.gateReuse: "until-change"` opt-in; all source and test evidence
  checks still apply.
- **Known limit**: a pass that tests a different tree than CI (climb's candidate branch) still runs its own gate; reuse is only for the exact commit.
- **Settled 2026-10-16 (the build):** the evidence of a reusable result is the run's `keel-test-runs` records (a gate record for the commit and tree, clean, the same command's hash, exit 0, and a test run under it that ran a test and failed none), never a job's name: a name cannot say which command ran on which tree. Only a success is reused; a red CI result runs the gate again. Reuse still needs an explicit `ci.gateWorkflow`.
- **Settled 2026-10-16:** docs-only is decided against the newest first-parent ancestor (at most 20 back) with a result of reuse grade at any age, and only for a clean commit; CI's own step (`gate.mjs --ci`) never reuses, it only skips or runs.
- **Open: the judges' base gates.** climb's guard and the robot's judge run the gate on the base, the commit CI tested. The judge job holds no token by design (the agent's code runs in that step), and the robot's judge strips `GITHUB_*` from the gate's env, so CI's run is not like for like there. Carrying CI's verified records in from a trusted step before the agent's code runs is the likely shape; not built.

## Next action

Decide the judges' base gates (Deliberately open): carry CI's verified base records into climb's guard and the robot's judge from a trusted step, or record that they keep running their own; then box 2 can be ticked. The owner's week of CI minutes waits on that.
