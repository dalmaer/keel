---
status: designed
since: 2026-10-23
goal: G3
spec: 2
depends: [122]
review: wait
note: "Package, approval and rollback contracts settled; build independent mechanics without live activation or bypassing the phase119 hold."
evidence: []
---

# Prepare reviewed promotion and traceable rollback

## Done when

A measured lesson produces a reviewable promotion package or evidence-backed rejection while preserving exact revision, rollback and follow-up history without self-activation.

## Scope

Implement the corresponding slice of [review-learning-evaluation](../specs/review-learning-evaluation.md).
The [implementation contract](../specs/lesson-promotion.md) defines strict packages,
dormant policy verification and exact-source observations. Independent mechanics
can proceed while real screening remains unavailable; do not land phase119
indirectly or manufacture a positive promotion walk.
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [ ] Ready-for-review requires supporting evidence; changed merged bytes, uncertain publication and recurrence preserve original records and require reconciliation: `tests/lesson-promotion.test.mjs`.
- [ ] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/lesson-promotion.test.mjs`.
- [ ] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Planned tests (not implemented by this specification):
`npm run check:focused -- tests/lesson-promotion.test.mjs`. The conductor runs
`npm run check` and `npm run typecheck` on the integrated implementation.
Record negative controls and original failures in an evidence file. Live model
work requires the exact approved comparison preview and retained provider receipts;
offline fixtures establish machinery only.

## Deliberately open

Provider activation, actual minute/currency allowance and practical cost tolerances
remain owner decisions before live work. Held-out cases are not yet authored;
public historical cases establish development coverage only. Existing handoff
experiments, hosted activation and fleet schedules are not changed by this phase.

## Next action

Build allowlisted packages and disabled-until-configured approval/merge verification,
then prove the offline public CLI package and source-refusal paths. Keep genuine
readiness and promotion open for missing delivery/provider interfaces and approval.
