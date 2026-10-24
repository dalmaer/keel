---
status: built
since: 2026-10-23
goal: G5
spec: 2
depends: [72, 111]
review: wait
note: "Local plan/freeze/inspect records validated and walked; no execution, budget reservation or task acceptance."
evidence: ["evidence/2026-10-23-evaluation-records.md"]
---

# Freeze harness evaluation inputs and extend the experiment ledger

## Done when

A harness experiment freezes case, configuration and comparison identities in the existing private experiment ledger without changing handoff behavior.

## Scope

Implement the corresponding slice of [harness-regression-evaluation](../specs/harness-regression-evaluation.md).
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [x] Record validators reject mutable or missing inputs, unsafe state roots and automatic application: `tests/evaluation-records.test.mjs`.
- [x] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluation-records.test.mjs`.
- [x] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Record foundation checks:
`npm run check:focused -- tests/evaluation-records.test.mjs`. The conductor runs
`npm run check` and `npm run typecheck` on the integrated implementation.
The owner-machine walk is retained as
`node docs/evidence/2026-10-23-evaluation-records-walk.mjs "$SOURCE_ROOT"`.
Its exact source path, exit and receipt identities are in the evidence. Live model
work requires the exact approved comparison preview and retained provider receipts;
offline fixtures establish machinery only.

## Deliberately open

Provider activation, actual minute/currency allowance and practical cost tolerances
remain owner decisions before live work. Held-out cases are not yet authored;
public historical cases establish development coverage only. Existing handoff
experiments, hosted activation and fleet schedules are not changed by this phase.

## Next action

None for this record foundation. Phase 118 adds isolated task execution and
independently controlled artifact acceptance; this phase grants no model budget.

## Trajectory

- **2026-10-23** — The record-only slice needed an explicit local freeze operation; using a future run command would imply authority it did not have. The spec now separates immutable storage from execution and reservations.
- **2026-10-23** — Conductor inspection found direct acceptance-material reuse in context and a retention check after writes. Reject byte-identical acceptance material in either arm's context and calculate retained size before mutation; dedicated negative checks cover both.
