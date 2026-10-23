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

## Independent source slice — authorized 23 October 2026

The parent explicitly authorized source schema/validator work in parallel with
phases 112/113. Their dependency remains binding for complete consumer evidence
and adoption; it does not block this isolated advisory foundation. Preserve
this phase as partial until real producers and all acceptance are verified.
No source gate, freshness policy or acceptance default changes in this slice.
The current gate validator remains untouched. See the source-slice contract in
[the spec](../specs/validation-efficiency.md#phase-114-independent-source-slice).

## Acceptance

- [ ] Source shadow contract rejects incomplete/mismatched evidence without execution or reuse authority: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-evidence.test.mjs`.

- [ ] Focused negative controls prove the phase contract: `node --import ./tests/helpers/hermetic.mjs --test tests/gate-reuse.test.mjs`.
- [ ] Required integrated checks pass: `npm run check`; `npm run typecheck`.
- [ ] Exact-head review is recorded: `node bin/plates.mjs review dalmaer/plates#<PR> --gate --json` plus inspection of pinned complete review inputs.
- [ ] ⚑ by hand: parent reviews evidence before broader rollout.

## Your part

- **Ask:** Review this stage’s evidence before changes are adopted more broadly.
- **Why:** Workflow and gate changes must preserve coverage and observed reliability.
- **Look at:** [The staged contract](../specs/validation-efficiency.md) and this phase’s evidence.
- **Choices:** Proceed with the next stage | Revise the stage
- **Takes:** About five minutes once review and checks finish.
- **Then:** A separate implementation PR advances the next stage; no production rollout is automatic.
- **Ready when:** Exact-head checks and normal review have completed.

## Real surfaces

- workflow shell: run the focused commands in Proof and inspect the required CI workflow at the exact reviewed head.

## Proof

Source slice: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-evidence.test.mjs tests/gate-reuse.test.mjs`. Run required changed-file conventions using `npm run check:focused -- tests/validation-evidence.test.mjs tests/gate-reuse.test.mjs` before the unchanged integrated checkpoint.

Complete phase: the source proof plus real producer and consumer equivalence tests in each consumer. Those later contracts wait for phases 112/113; synthetic fixtures do not satisfy them.

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Implement the authorized source-only shadow contract and adversarial validator tests first. Consumer producers, real stage equivalence, existing-validator integration and reuse adoption remain blocked on completed phases 112/113 and explicit review.
