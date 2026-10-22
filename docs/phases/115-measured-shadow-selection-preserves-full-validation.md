---
status: designed
since: 2026-10-22
goal: G5
spec: 2
depends: [111, 114]
review: wait
note: "Staged implementation from the migration audit; required gate policy unchanged."
evidence: []
---

# Measured shadow selection preserves full validation

## Done when

Comparable telemetry and shadow selection expose measured costs and misses without changing mandatory gate coverage.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 115.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract.
- [ ] Required integrated checks and exact-head review are recorded.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Real surfaces

The named source/consumer checkout and its required reviewed CI workflow.

## Proof

`Run shadow replay coverage/invalidation tests and at least five paired fixed-head performance trials.`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Collect matching baseline cohorts; retain current required gates while measuring.
