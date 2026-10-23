---
status: built
since: 2026-10-23
goal: G4
spec: 2
depends: [15, 26, 70]
review: wait
note: "Each plate owns verification; the fleet reads revision-bound evidence without rerunning project gates."
evidence: ["evidence/2026-10-23-plate-verification.md"]
---

# Each plate verifies itself and the fleet checks coverage

## Done when

Each project's existing nightly report carries revision-bound verification and claim findings, and Plates identifies missing, stale or mismatched fleet evidence without executing consumer gates or changing acceptance.

## Scope

[Distributed verification contract](../specs/plate-verification.md). Extend the
existing night report, reconciliation and fleet readers. No second tracker,
new cron, model budget, automatic claim deletion or consumer rollout.

## Acceptance

- [x] Project receipts bind source/default-branch identity, gate outcome and reuse attribution, reconciliation coverage, and claim findings: `tests/plate-verification.test.mjs`.
- [x] Claims on completed phases remain visible; open PRs and unknown session activity are distinct; unavailable/paginated reads cannot mean healthy: `tests/plate-verification.test.mjs`.
- [x] The existing report/workflow preserves machine-readable evidence and the human summary without a second gate, including failed attempts across fresh-checkout retries and refusal of a stale publication lease: `tests/plate-verification.test.mjs` and `tests/workflows.test.mjs`.
- [x] Plates home includes fleet coverage in its existing nightly report without adding consumer work: `tests/fleet-verification.test.mjs`.
- [x] Fleet consumption rejects missing, malformed, stale, foreign or wrong-revision evidence and performs no project execution: `tests/fleet-verification.test.mjs`.
- [x] Local/shipped copies, agent help, conventions and required gates pass: `npm run check:focused -- tests/plate-verification.test.mjs tests/fleet-verification.test.mjs`; `npm run check`; `npm run typecheck`.
- [x] Read-only GitHub walk records current Plates identity and genuine fleet coverage gaps; a packed synthetic adopter proves the shipped producer is usable: `node /tmp/plates-phase116-walk.mjs "$SOURCE_ROOT" "$PACKED_ROOT"` (resolved paths, retained script and output in evidence).

## Real surfaces

- GitHub API: read current Plates default-branch, claims and PR facts; record unavailable permissions without mutation.
- published package: install this candidate into a synthetic Acme checkout and execute its shipped report path with bounded source inputs.

## Proof

Run the acceptance commands above. Negative controls include old green CI,
changed default branch with unchanged report date, malformed/foreign receipt,
completed claim, open PR, truncated API response and missing reconciliation.
The fleet must never invoke a consumer gate. Retain the first failing result.
Record exact live and packed commands in evidence before performing the walks.

## Deliberately open

Fleet-wide installation and observation over multiple real nights follow reviewed
release/update lanes. This phase proves implementation and source walks, not
fleet adoption or production acceptance. GitHub cannot establish local session
liveness; activity remains unknown. Automatic cleanup is deferred to a separate
explicit policy. Existing schedules and budgets remain unchanged.

## Next action

Release through the reviewed practice lane, update adopting projects, and observe
real nightly receipts before claiming fleet installation or lived-in usefulness.

## Trajectory

- **2026-10-23** — Local report retention did not cover fresh workflow checkouts. Recover the exact prior night report and publish under its head lease; preserve failures across retries and refuse concurrent replacement.

- **2026-10-23** — Cleaning seven retained claims showed completed phases were skipped by claim warnings. Report that state explicitly; absence of activity evidence is not proof of inactivity.
