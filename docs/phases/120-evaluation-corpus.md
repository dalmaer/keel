---
status: designed
since: 2026-10-23
goal: G5
spec: 2
depends: [119]
review: wait
note: "Specified only; production implementation and paid evaluation have not started."
evidence: []
---

# Freeze six historically grounded development cases

## Done when

All six historical case definitions retain source provenance, independent acceptance and explicit development versus held-out exposure.

## Scope

Implement the corresponding slice of [harness-regression-evaluation](../specs/harness-regression-evaluation.md).
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [ ] Case fixtures prove compatibility, recovery, initialization, scoped repair, integration and ordinary control contracts without exposing fixes to builders: `tests/evaluation-corpus.test.mjs`.
- [ ] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluation-corpus.test.mjs`.
- [ ] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Planned tests (not implemented by this specification):
`npm run check:focused -- tests/evaluation-corpus.test.mjs`. The conductor runs
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

Curate the six pinned historical cases and independently controlled checks; record held-out coverage as zero until privately authored.
