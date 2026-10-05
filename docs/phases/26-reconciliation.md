---
status: built
since: 2026-10-04
goal: G4
depends: [5, 15, 18]
note: "Shared checks, PR impact declarations and manual proposals ship in doctor, CI and night health. Ledger main and its correction branch audited read-only; merge never advances acceptance."
evidence: ["evidence/2026-10-04-reconciliation.md"]
---

# Phase records agree with delivery facts and current decisions

## Done when

Keel's existing checks detect and propose scoped corrections for merged-PR, completed-next-action and superseded-decision contradictions on an adopted project, without inferring acceptance, production verification or lived-in status from a merge.

## Scope

Implement [the reconciliation practice design](../research/2026-10-04-reconciliation-practice.md): shared local/remote checks in doctor and improve, PR impact declarations, anchored decision and evidence references, and corrections through existing review workflows. Preserve Ledger's local phase format, old measurements and architecture history. No separate work tracker.

## Acceptance

- [x] Local references, acceptance IDs, next actions and decision supersession are checked by existing doctor/phase checks; both supported phase shapes and Ledger's local format retain their meaning. <!-- acceptance: local-records -->
- [x] PR checks require affected phases/decisions and actual record updates or explicit per-record reasons; generated roadmaps remain checked views. <!-- acceptance: pr-impact -->
- [x] Read-only GitHub comparison detects merge contradictions; absent or failed observations are unknown, never a clean result. <!-- acceptance: remote-facts -->
- [x] Implemented, merged, production-verified and lived-in remain independently evidenced; an unchecked acceptance item survives every merge reconciliation unchanged. <!-- acceptance: separate-proof -->
- [x] Existing health reports propose scoped corrections, deduplicate repeated observations and reject patches whose base records or remote facts changed; record edits never auto-merge through the data queue. <!-- acceptance: manual-proposals -->
- [x] Synthetic Acme failure cases cover stale next work, scoped supersession, historical evidence, preview versus production, reverts, open correction PRs and human-only acceptance decisions. <!-- acceptance: failure-cases -->
- [x] A read-only Ledger audit of PRs 22 and 38 produces justified corrections or confirms they are already reconciled, with current source SHAs and no invented proof. <!-- acceptance: ledger-audit -->

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/reconciliation.test.mjs tests/reconciliation-integration.test.mjs tests/helpers.test.mjs`
checks the shared engine, doctor/night integration, actual PR diffs, proposal
freshness, local formats and synthetic guard mutations. `node bin/keel.mjs
improve --selftest --json` exercises the intentionally unhealthy fixture.
Then `npm run check` covers the final integrated tree and generated records.

Live proof: invoke `reconcile({root, github: true})` on pinned read-only
Ledger main and correction-branch snapshots, then `verifyProposal` with fresh GitHub
facts. See the evidence for revisions, results, remaining acceptance and
legacy coverage limits. No deployment, benchmark or issue closure is inferred.

## Deliberately open

- Which existing Ledger decision headings need stable anchors is settled during adoption with its owner; the multi-user settled entries already hold the decision.
- An optional model pass for ambiguous prose is deferred. Deterministic reference checks and human review ship first; scheduling model spend needs the owner's yes.

## Next action

For lived-in: adopt stable references in a real project and observe repeated
PR/night reconciliation through actual changes. Ledger adoption requires its
own reviewed records; this phase did not edit Ledger.

## Reconciliation

```keel-reconciliation
{"version":1,"prs":[],"decisions":[],"implementation":[],"production":[],"use":[],"next":{"kind":"use","ref":"docs/evidence/2026-10-04-reconciliation.md#gaps-and-decision"}}
```

## Trajectory

- **2026-10-04** — Implementation depends on phase 15's shipped repo-local night runtime, which is built. Phase 10's remaining seven-night observation is not a prerequisite to adding another check.
- **2026-10-04** — Legacy prose stays advisory. The real Ledger audit exposed ordinary review-history false positives; bounded PR wording and explicit reference checks replaced broad matching. Main produces four manual proposals; the corrected branch head retains coverage notes only.
- **2026-10-04** — Reconciliation ships as an optional standalone practice shared by existing doctor and night checks. Typed metadata augments both phase shapes; no forced migration, status duplication or automatic record application.
