---
status: designed
since: 2026-10-23
goal: G3
spec: 2
depends: [120]
review: wait
note: "Specified only; production implementation and paid evaluation have not started."
evidence: []
---

# Bind selected review lessons to hypotheses and evaluation plans

## Done when

Selected real findings form deduplicated, scoped hypotheses with append-only transitions and comparison references in the existing learn records.

## Scope

Implement the corresponding slice of [review-learning-evaluation](../specs/review-learning-evaluation.md).
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [ ] Transitions preserve rationale, provenance and legacy projections; missing evidence and legacy acceptance bypass refuse: `tests/evaluated-lessons.test.mjs`.
- [ ] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluated-lessons.test.mjs`.
- [ ] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Planned tests (not implemented by this specification):
`npm run check:focused -- tests/evaluated-lessons.test.mjs`. The conductor runs
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

Extend selected learn records with the strict evaluation section and transition validator.
