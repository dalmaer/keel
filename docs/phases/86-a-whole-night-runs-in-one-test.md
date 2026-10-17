---
status: planned
since: 2026-10-16
goal: G0
spec: 2
depends: [73, 76, 77, 78]
note: "Specified 2026-10-16: one test runs a whole night (plan, a ticking pass, the morning and the card) and checks what the owner would see."
evidence: []
issue: 171
---

# A whole night runs in one test

## Done when

One test runs a night end to end, with a frozen clock, a bare-origin repo, a stubbed GitHub and the fake isocan: the night writes its plan, a climb pass ticks its item, the morning decides, finalizes and sends the brief, and the card is published; the test checks the brief and the card say what happened.

## Scope

The design is [Verification: tests that tell right from plausibly wrong](../research/2026-10-16-verification.md), phase 86.

- **The box**: a fixture project with keel's night, climb and personas practices; the plan branch on a bare origin; `KEEL_GH` stubbing issues and PRs; the fake isocan from `tests/helpers/isocan.mjs`.
- **The run**: the night's plan step, a climb tick (done with a PR link), a failed item, the morning's decide, finalize and send, and the card.
- **The oracle**: the brief's sections (done, failed with its reason, not finished), its links, one issue sent, and the card's final version showing every item's status.
- **Speed**: under 30 seconds in the gate; no network.

## Acceptance

- [ ] A night with one done, one failed and one unfinished item produces a brief with each in the right section and its link or reason. `tests/night-box.test.mjs`
- [ ] Exactly one morning issue is sent, and the card's last version shows each item's final status. `tests/night-box.test.mjs`
- [ ] Breaking any one stage (the plan write, the tick, finalize, send, the card) fails the test, naming the stage. `tests/night-box.test.mjs`
- [ ] The test runs in under 30 seconds with no network. `tests/night-box.test.mjs`
- [ ] ⚑ by hand: none; the real nights are the walks of phases 73–78.

## Your part

- **Ask:** Nothing to do for this one; it is a test of the night itself.
- **Why:** It catches a broken night before a real one does.
- **Look at:** the test in CI.
- **Choices:** Fine | Something to change
- **Takes:** 10 minutes.
- **Then:** Something: say what.
- **Ready when:** this phase has shipped.

## Real surfaces

none

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/night-box.test.mjs`; `npm run check`.

## Deliberately open

- **Robot and Loop** join the box once the robot's sandbox is unblocked (phase 54).
- **Known limit**: GitHub's own scheduling (workflow_run order, concurrency) is simulated, not run.

## Next action

Build the box from the existing fixtures, starting with plan → tick → brief.
