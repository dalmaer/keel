---
status: partial
owes: walk
since: 2026-10-16
goal: G0
spec: 2
depends: [73, 76, 77, 78]
note: "Built 2026-10-17: tests/night-box.test.mjs runs one night end to end through the shipped workflows' own steps (goodnight, plan, measure, the climb tick, decide, finalize, send, the card) with a frozen clock, a bare origin, a stub gh and the fake isocan, and reads the brief and the card; breaking any one stage names it. Owes the owner a look at it in CI."
evidence: ["evidence/2026-10-17-night-in-a-box.md"]
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

- [x] A night with one done, one failed and one unfinished item produces a brief with each in the right section and its link or reason. `tests/night-box.test.mjs`
- [x] Exactly one morning issue is sent, and the card's last version shows each item's final status. `tests/night-box.test.mjs`
- [x] Breaking any one stage (the plan write, the tick, finalize, send, the card) fails the test, naming the stage. `tests/night-box.test.mjs`
- [x] The test runs in under 30 seconds with no network. `tests/night-box.test.mjs`
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

- **The clock, settled 2026-10-17 by the build**: frozen where it is read. Every node a workflow step starts loads `tests/helpers/night-box-preload.mjs` (NODE_OPTIONS: `new Date()` and `Date.now()` say the stage's time, and any socket, DNS lookup or fetch throws), the night's `date -u +%F` is a `date` on PATH, and the in-process stages (goodnight, the card) take `now`.
- **What runs, settled 2026-10-17 by the build**: the shipped YAML's own shell for each step (runBlocks), each job in a fresh clone of the bare origin. Simulated: which job follows which and each job's `if:` (the test asserts the `if:` text it simulates), artifacts between jobs, climb's agent and judge (the publish job's tick step is handed their outcome), and the card's CI provisioning (pinned keel and isocan, the journal restore: `tests/morning.test.mjs`); the card publishes through `publishPlanCard` from the owner's checkout, where the fake isocan home's manifest lives.
- **Under 30 seconds, settled 2026-10-17 by the build**: at the machine's quiet pace. The box is processes and nothing that waits, so a pace sample (ten node starts and ten gits) taken either side scales out the load of the gate's 32 files at once (lesson 40); the raw time is printed beside it.
- **Robot and Loop** join the box once the robot's sandbox is unblocked (phase 54).
- **Known limit**: GitHub's own scheduling (workflow_run order, concurrency) is simulated, not run.

## Next action

The ⚑ walk: the owner looks at `tests/night-box.test.mjs` in CI (Your part) and answers with `keel walk done 86 --choice "<choice>"`.
