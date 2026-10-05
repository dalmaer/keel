---
status: designed
since: 2026-10-04
goal: G4
depends: [5, 15, 18]
note: "Practice designed from Ledger PRs 22 and 38: GitHub owns merge facts, phases own acceptance and next work, decisions own architecture. No reconciliation checker is implemented yet."
evidence: []
---

# Phase records agree with delivery facts and current decisions

## Done when

Keel's existing checks detect and propose scoped corrections for merged-PR, completed-next-action and superseded-decision contradictions on an adopted project, without inferring acceptance, production verification or lived-in status from a merge.

## Scope

Implement [the reconciliation practice design](../research/2026-10-04-reconciliation-practice.md): shared local/remote checks in doctor and improve, PR impact declarations, anchored decision and evidence references, and corrections through existing review workflows. Preserve Ledger's local phase format, old measurements and architecture history. No separate work tracker.

## Acceptance

- [ ] Local references, acceptance IDs, next actions and decision supersession are checked by existing doctor/phase checks; both supported phase shapes and Ledger's local format retain their meaning.
- [ ] PR checks require affected phases/decisions and actual record updates or explicit per-record reasons; generated roadmaps remain checked views.
- [ ] Read-only GitHub comparison detects merge contradictions; absent or failed observations are unknown, never a clean result.
- [ ] Implemented, merged, production-verified and lived-in remain independently evidenced; an unchecked acceptance item survives every merge reconciliation unchanged.
- [ ] Existing health reports propose scoped corrections, deduplicate repeated observations and reject patches whose base records or remote facts changed; record edits never auto-merge through the data queue.
- [ ] Synthetic Acme failure cases cover stale next work, scoped supersession, historical evidence, preview versus production, reverts, open correction PRs and human-only acceptance decisions.
- [ ] A read-only Ledger audit of PRs 22 and 38 produces justified corrections or confirms they are already reconciled, with current source SHAs and no invented proof.

## Proof

Planned automated proof: hermetic focused tests for the shared reconciliation reader/comparator, doctor, improve and workflow integration; guard mutations named in the design. Tests load `tests/helpers/hermetic.mjs` and use synthetic Acme records and a stubbed GitHub boundary. Then one integrated `npm run check` and regenerated-roadmap check.

Live proof: read GitHub and the current Ledger phase/decision records; compare findings with the bounded #38 correction and record unresolved acceptance separately. Review any proposed document patch before applying. No deployment, benchmark, resource creation or issue closure is part of this proof.

## Deliberately open

- Which existing Ledger decision headings need stable anchors is settled during adoption with its owner; the multi-user settled entries already hold the decision.
- An optional model pass for ambiguous prose is deferred. Deterministic reference checks and human review ship first; scheduling model spend needs the owner's yes.

## Next action

Implement the shared local reference model and synthetic contradiction fixtures first, extending doctor and existing phase checks before adding the read-only GitHub comparison.

## Trajectory

- **2026-10-04** — Implementation depends on phase 15's shipped repo-local night runtime, which is built. Phase 10's remaining seven-night observation is not a prerequisite to adding another check.
