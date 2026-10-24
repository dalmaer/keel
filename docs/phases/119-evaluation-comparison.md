---
status: designed
since: 2026-10-23
goal: G5
spec: 2
depends: [118]
review: wait
note: "Specified only; production implementation and paid evaluation have not started."
evidence: []
---

# Compare paired harness trials and resume interrupted comparisons

## Done when

A frozen paired comparison preserves all attempts, enforces total allowance and reports per-case outcomes, costs, uncertainty and safe recovery.

## Scope

Implement the corresponding slice of [harness-regression-evaluation](../specs/harness-regression-evaluation.md).
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [ ] Five-pair plans include controls; crash recovery preserves successful trials, original leases and uncertain spend; reports retain failures: `tests/evaluation-comparison.test.mjs`.
- [ ] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluation-comparison.test.mjs`.
- [ ] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

- [ ] ⚑ by hand: after the owner approves the exact provider and bounded allowance, retain the real compatibility/control screening report (five pairs each), with unknowns and a justified disposition; a fake-adapter walk is not measured agent efficacy.

## Your part

- **Ask:** Approve the exact provider and maximum spend for the prepared comparison.
- **Why:** Real agent outcomes require a paid trial; offline fixtures cannot establish improvement.
- **Look at:** The frozen comparison preview and its cost/authority limits.
- **Choices:** Approve the quoted comparison | Keep evaluation offline
- **Keeps it open:** Keep evaluation offline
- **Takes:** About five minutes to review the prepared quote.
- **Then:** Approval permits only the bounded comparison; otherwise retain the design and offline proof.
- **Ready when:** The adapter, isolation proof and exact comparison quote are available.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Planned tests (not implemented by this specification):
`npm run check:focused -- tests/evaluation-comparison.test.mjs`. The conductor runs
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

Implement paired plan admission, interleaved ordering and immutable comparison reports.
