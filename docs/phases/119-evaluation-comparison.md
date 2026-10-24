---
status: partial
since: 2026-10-23
goal: G5
spec: 2
depends: [118]
review: wait
note: "Owner review-limit decision required for the remaining cancellation finding; offline proof is retained and live provider/spend work remains pending."
evidence: ["evidence/2026-10-23-evaluation-comparison.md"]
---

# Compare paired harness trials and resume interrupted comparisons

## Done when

A frozen paired comparison preserves all attempts, enforces total allowance and reports per-case outcomes, costs, uncertainty and safe recovery.

## Scope

Implement the corresponding slice of [harness-regression-evaluation](../specs/harness-regression-evaluation.md).
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [x] Five-pair plans include controls; crash recovery preserves successful trials, original leases and uncertain spend; reports retain failures: `tests/evaluation-comparison.test.mjs`.
- [x] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluation-comparison.test.mjs`.
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

Implemented offline proof:
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

Resolve PR #249's three-round review hold with the owner before further fixes or
merge. The remaining cancellation-intent crash finding is recorded in the evidence;
no dependent PR may land it indirectly. After that decision, select an isolation-capable live
provider/runtime and implement its enforced spending gateway before preparing
the exact owner-approved screening quote. This is an implementation gap as well
as an approval boundary, so this phase is not marked `owes: walk`.
Continue the independent historical corpus and lesson-record work in phases
120–123 against the proven offline contracts; do not infer live efficacy from
their fixture results.


## Trajectory

- **2026-10-23** — A crash leaves more than a missing result: recovery now verifies original writer death, serializes lock ownership, retains stage authorization and preserves original verdicts. Legacy or partial ownership stays blocked rather than being reclaimed by age.
- **2026-10-23** — Whole-comparison storage and recovery reservations are needed before admission. New plans can explicitly reserve up to 64 MiB; old frozen ceilings remain unchanged. Preparation reduces each admitted execution deadline, and uncertain operations never refund capacity.
- **2026-10-23** — Independent proof found image objects must be compared structurally after receipt deserialization. The real twenty-slot walk retained all target/control outcomes and unknown costs; its known scripted patch remains inconclusive about agent improvement.
- **2026-10-23** — Live provider execution is not supplied by an offline scripted adapter. Preserve the code/activation gap explicitly while continuing later work that depends only on the implemented offline contracts.
