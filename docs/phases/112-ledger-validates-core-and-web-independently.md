---
status: designed
since: 2026-10-22
goal: G2
spec: 2
depends: [110]
review: wait
note: "Staged implementation from the migration audit; required gate policy unchanged."
evidence: []
---

# Ledger validates core and web independently

## Done when

Ledger core and web start independently after scope resolution with the existing stage coverage, clocks and failure propagation preserved.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 112.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract.
- [ ] Required integrated checks and exact-head review are recorded.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Real surfaces

The named source/consumer checkout and its required reviewed CI workflow.

## Proof

`Run Ledger workflow contract tests and both unchanged required CI lanes on the reviewed candidate.`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Prepare a separate Ledger PR using its repository instructions and scope job contracts.
