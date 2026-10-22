---
status: designed
since: 2026-10-22
goal: G5
spec: 2
depends: [110]
review: wait
note: "Staged implementation from the migration audit; required gate policy unchanged."
evidence: []
---

# Focused feedback starts with capability and resource checks

## Done when

An advisory focused-first plan fails closed for unknown/shared inputs and an opt-in resource budget preserves every required gate.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 111.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract.
- [ ] Required integrated checks and exact-head review are recorded.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Real surfaces

The named source/consumer checkout and its required reviewed CI workflow.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/validation-plan.test.mjs tests/validation-budget.test.mjs`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

After phase 110 review, implement preflight and explicit selection mappings with broad fallback tests.
