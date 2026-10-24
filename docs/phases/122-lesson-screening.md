---
status: partial
since: 2026-10-24
goal: G3
spec: 2
depends: [121]
review: wait
note: "Offline screening and immutable report binding verified; real screening still needs per-case environments, live provider/spend integration and owner allowance."
evidence: ["evidence/2026-10-24-lesson-screening.md"]
---

# Measure one real review improvement against a control

## Done when

One approved narrow historical lesson produces a retained baseline-candidate screening report with control outcomes and a justified promote, reject or inconclusive recommendation.

## Scope

Implement the corresponding slice of [review-learning-evaluation](../specs/review-learning-evaluation.md).
The [screening implementation contract](../specs/lesson-screening.md) settles
registration, actual delivery and immutable report binding. Independent machinery
can proceed while phase 119 awaits its owner review-limit decision; this branch
cannot land that held work indirectly.
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [x] Plan and report binding rejects altered patches, omitted attempts, unknown required costs and weakened acceptance: `tests/lesson-screening.test.mjs`.
- [x] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/lesson-screening.test.mjs`.
- [x] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

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

Implemented focused proof:
`npm run check:focused -- tests/lesson-screening.test.mjs`. The conductor runs
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

Resolve the phase119 owner merge hold before landing this stack. Implement explicit
per-case environment mapping and live provider/spending support before preparing
a real quote for owner approval; keep historical target/control screening open.

## Trajectory

- **2026-10-24** — The real CLI walk refused differing case environments before execution. Shared synthetic probe inputs prove this adapter; historical target/control environments need an explicit per-case mapping, not normalized hashes. The first refusal and corrected 20-trial walk are retained in the evidence.
- **2026-10-24** — A report can publish before its inbox link. Recovery reserves the original operation, blocks replacement UUIDs and verifies original bytes even on duplicate requests; evaluated remains distinct from supported or promoted.
