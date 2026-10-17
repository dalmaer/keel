---
status: planned
since: 2026-10-16
goal: G6
spec: 2
depends: [80]
note: "Specified 2026-10-16 from ledger's verify-production and live-SHA skip: a deploy is skipped when production already serves the commit and verified by what production reports."
evidence: []
issue: 164
---

# Production is checked by the commit it serves

## Done when

A deploy is skipped when production already serves the commit or a descendant; after a deploy, keel waits until production reports the deployed commit (or a descendant) at the project's version endpoint and passes its smoke checks; and a failure reaches the owner once, in the morning issue and on the board.

## Scope

The design is [Delivery: a change reaches production once, checked](../research/2026-10-16-delivery.md), items 3, 4 and 8.

- **The contract**: `delivery.version` names an endpoint returning the serving commit (ledger's `/api/version`, isocan's `/api/healthz`). `scripts/keel/verify.mjs` reads it, checks ancestry against the repo, retries for a bounded time, then runs `delivery.smoke` (paths with expected status codes).
- **Skip what is live**: `verify.mjs live` answers "does production already serve this commit or a descendant", so a deploy step can skip itself.
- **After a deploy**: the publish workflow (phase 80) or the project's deploy runs `verify.mjs` and records the result on the tested ref's commit.
- **One alert**: a failed verify is an owner's item on the board and a line in the next morning brief; a project may add its own channel.

## Acceptance

- [ ] `verify.mjs` passes when the endpoint reports the commit or a descendant and every smoke check matches, and fails, naming which, otherwise; it retries within a bound and never reports success it did not see. `tests/verify.test.mjs`
- [ ] `verify.mjs live` says yes for the commit or a descendant and no otherwise. `tests/verify.test.mjs`
- [ ] A failed verify is an owner's item on the board and in the morning brief. `tests/board.test.mjs`, `tests/morning.test.mjs`
- [ ] ⚑ by hand: the owner reads one real failed verify (or a deliberate one on a preview) in the morning brief.

## Your part

- **Ask:** When a deploy's verify fails (or one made to fail on a preview), read how the morning brief and board say it.
- **Why:** A broken production should reach you once, clearly, the next morning.
- **Look at:** the morning brief.
- **Choices:** Clear | Unclear
- **Takes:** 10 minutes.
- **Then:** Unclear: the wording is fixed.
- **Ready when:** this phase has shipped to ledger or isocan.

## Real surfaces

- Adopted project: ledger's `/api/version`, isocan's `/api/healthz`.
- Workflow shell: the verify step.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/verify.test.mjs tests/board.test.mjs tests/morning.test.mjs`; `npm run check`.
By hand: one real failed verify read in the brief.

## Deliberately open

- **isocan's endpoint**: its docs disagree on `/healthz` and `/api/healthz`; the project names the one that works.
- **Known limit**: smoke checks are status codes and headers, not end-to-end journeys.

## Next action

Write `verify.mjs` with a stub HTTP server in `tests/verify.test.mjs`.
