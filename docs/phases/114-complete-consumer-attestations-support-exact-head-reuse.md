---
status: designed
since: 2026-10-22
goal: G4
spec: 2
depends: [112, 113]
review: wait
note: "Staged implementation from the migration audit; required gate policy unchanged."
evidence: []
---

# Complete consumer attestations support exact-head reuse

## Done when

Consumer configured-gate reuse is accepted only from complete exact-head equivalent stage evidence and adversarial invalidation tests reject unsupported reuse.

## Scope

[Validation efficiency spec](../specs/validation-efficiency.md), phase 114.
Only source and existing manifest-managed consumers. No deployment or schedule.

## Acceptance

- [ ] Focused negative controls prove the phase contract.
- [ ] Required integrated checks and exact-head review are recorded.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Real surfaces

The named source/consumer checkout and its required reviewed CI workflow.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/gate-reuse.test.mjs; producer and consumer equivalence tests in each consumer.`

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Inventory all local and CI stages before designing any attestation producer.
