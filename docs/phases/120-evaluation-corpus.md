---
status: built
since: 2026-10-24
goal: G5
spec: 2
depends: [119]
review: wait
note: "Six offline development cases, installed CLI and integrated gates verified; review and phase 119 merge hold remain."
evidence: ["evidence/2026-10-23-evaluation-corpus.md"]
---

# Freeze six historically grounded development cases

## Done when

All six historical case definitions retain source provenance, independent acceptance and explicit development versus held-out exposure.

## Scope

Implement the corresponding slice of [harness-regression-evaluation](../specs/harness-regression-evaluation.md), including its dated Phase 120 corpus contract.
Independent corpus preparation uses phase 119’s offline interfaces without its
missing live-provider activation. While PR #249 waits for the owner’s review-limit
decision, this dependent branch cannot merge it indirectly.
Reuse the existing experiment, learn, execution and evidence mechanisms. Do not
introduce a second scheduler, evidence authority or automatic production default.

## Acceptance

- [x] Case fixtures prove compatibility, recovery, initialization, scoped repair, integration and ordinary control contracts without exposing fixes to builders: `tests/evaluation-corpus.test.mjs`.
- [x] CLI JSON/help, compatibility, bounds and failure paths are covered: `npm run check:focused -- tests/evaluation-corpus.test.mjs`.
- [x] Integrated gates and selected contracts pass: `npm run check`; `npm run typecheck`.

## Real surfaces

- owner's machine: use a fresh private external workspace and synthetic Acme fixture; retain exact invocation and receipt identities before claiming built.

## Proof

Implemented focused proof:
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

Keep held-out coverage zero and the dependent branch unmerged until phase 119’s
owner review decision is resolved. Exact-head review and CI passed as recorded
in the evidence; revalidate both against the final head before landing.

## Trajectory

- **2026-10-23** — The broad canvas snapshot dependency chain exceeds delivery bounds. Scope the recovery case to the actual caller-supplied-card APIs used by its original regression; preserve crash/retry and human-edit assertions, disclose excluded snapshot/export coverage, and prove the exercised closure before calling it runnable.
