---
status: partial
since: 2026-10-23
goal: G4
spec: 2
depends: [112, 113]
review: wait
note: "Fresh complete local review found a collector type-coercion defect; focused correction preserves unknowns. Corrected-head gates/review and complete producers/equivalence remain separate."
evidence: ["evidence/2026-10-23-validation-evidence-foundation.md", "evidence/2026-10-23-ledger-retained-evidence.md"]
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

## Ledger collector slice — authorized 23 October 2026

The shadow foundation merged as PR 228 and main 1407926 passed its complete
gate/typecheck. This next slice only ingests existing Ledger jobs/artifacts
against a reviewed versioned coverage manifest. It grants no reuse authority.
See the [collector contract](../specs/validation-efficiency.md#phase-114-ledger-retained-evidence-collector-slice).

## Acceptance

- [x] Ledger retained-evidence ingestion preserves archive/provenance and coverage gaps: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-ledger.test.mjs`.

- [x] Source shadow contract rejects incomplete/mismatched evidence without execution or reuse authority: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-evidence.test.mjs`.

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

Source collector slice: `node --import ./tests/helpers/hermetic.mjs --test tests/validation-ledger.test.mjs tests/validation-audit.test.mjs tests/validation-evidence.test.mjs`. Run required changed-file conventions using `npm run check:focused -- tests/validation-ledger.test.mjs tests/validation-audit.test.mjs tests/validation-evidence.test.mjs` before the unchanged integrated checkpoint. Existing gate-reuse compatibility remains covered at integration; no active gate code changes.

Complete phase: the source proof plus real producer and consumer equivalence tests in each consumer. Those later contracts wait for phases 112/113; synthetic fixtures do not satisfy them.

Source required integrated checkpoint: `npm run check`; `npm run typecheck`.
Run focused checks first; do not repeat full suites during builder iteration.

## Deliberately open

Observed speed savings remain unknown until matched trials. Later phases and
consumer adoption wait for the preceding review; no policy is weakened here.

## Next action

Complete corrected-head source integration, CI and independent correction review after the fresh full local review found non-string digest coercion. Preserve prior gate/review attempts separately. Then consolidate actual consumer acceptance, authenticated producer/input lineage and complete equivalence in separately reviewed work before any validator/reuse adoption. This phase stays partial.

## Trajectory

- **2026-10-23** — The parent authorized independent schema/validator work while consumer stages remain in flight. Keep phase 114 partial and preserve dependency requirements for real equivalence/adoption; shadow coverage is not gate authority. [Evidence](../evidence/2026-10-23-validation-evidence-foundation.md).
- **2026-10-23** — GitHub artifact identity and expiry are assigned after upload, so producer bytes cannot embed them. Bind execution source inside records and validate separate download metadata/hash outside the bytes; checksum identity still does not authenticate origin. [Evidence](../evidence/2026-10-23-validation-evidence-foundation.md).

- **2026-10-23** — A real retained-run walk exposed raw-plus-JSON source-byte transformation after the focused source-size control passed. Preserve the failed walk, use fixed plain-raw transport, and reject altered hashes without refreshing expected bindings. All seven source bindings and both archives then verified, while 69 explicit legacy gaps remain. [Evidence](../evidence/2026-10-23-ledger-retained-evidence.md).

- **2026-10-23** — A fresh local review covered all 1,255 diff lines and required lessons/spec/phase context, exposing a non-string regex coercion defect missed by the partial hosted reviews. Preserve that finding and prove the typed-boundary correction fails without its fix; no passing prior-head gate is carried to the changed candidate. [Evidence](../evidence/2026-10-23-ledger-retained-evidence.md#fresh-complete-local-review-and-boundary-correction).
