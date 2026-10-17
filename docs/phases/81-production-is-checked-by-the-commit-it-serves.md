---
status: partial
since: 2026-10-17
goal: G6
spec: 2
depends: [80]
note: "Partial 2026-10-17: the delivery practice's verify.mjs checks production serves the commit or a descendant and passes its smoke checks, says whether a commit is already live, and records each result on keel-verify, where a failure is the owner's on the board and a line in the next morning brief. The owner's read of a real failure waits."
evidence: ["evidence/2026-10-17-verify.md"]
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

- [x] `verify.mjs` passes when the endpoint reports the commit or a descendant and every smoke check matches, and fails, naming which, otherwise; it retries within a bound and never reports success it did not see. `tests/verify.test.mjs`
- [x] `verify.mjs live` says yes for the commit or a descendant and no otherwise. `tests/verify.test.mjs`
- [x] A failed verify is an owner's item on the board and in the morning brief. `tests/board.test.mjs`, `tests/morning.test.mjs`
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
- **Known limit**: smoke checks are status codes and headers, not end-to-end journeys. (Built: status codes only; headers stay open.)
- **Settled 2026-10-17, building: the result is recorded on a data branch, `keel-verify` (`verify.json`, newest first, the last 30 and, since the PR #182 review, every failure of the last 72 hours, so a burst of passes never drops one before its brief), not as a commit status or a git note**: the morning brief already reads origin branches with git (the plan branch), so it needs no new token scope, and the board reads the same file; each entry names the commit it verified. Scope's "records the result on the tested ref's commit" is met by that `sha`, not by a mark on the commit itself.
- **Settled 2026-10-17, building: production needs an origin, `delivery.site`**, beside `version` and `smoke` (paths): the research's `"version": "/api/version"` has no host. `--site` overrides it for a preview.
- **Settled 2026-10-17, building: "once" in the brief is a partition by time**: each failure recorded in the day before a night started (07:23 UTC to 07:23 UTC) is that night's brief's, so every failure reaches exactly one brief; the board keeps the latest failure as the owner's item until a later verify passes.
- **Settled 2026-10-17, building: keel ships no verify workflow**: deploys are each project's (ledger's Actions deploy, isocan's Cloud Build), so the verify step is a documented snippet in `docs/guide/delivery.md`, run after the project's own deploy. keel-publish.yml does not run it: the publisher finishes before a deploy that follows it has started.

## Next action

⚑ Ship delivery's verify to ledger (`delivery.site`, `version: "/api/version"`, its smoke paths, the verify step after its deploy with `--record`; ⚑: it pushes `keel-verify` there), then the owner reads one failed verify (a deliberate one on a preview) in the morning brief.
