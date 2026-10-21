# Evidence: Decisions change the reviewed source

- Date: 2026-10-21
- Phase: 97
- Revision: `d7d021687548f6e760d258b59579c1e76105058e` plus working tree for the initial checks; identity correction designed in `17ce56a8c9ec600352234fca8ba5563cde1705c7`.
- Claim: exact previews and conditional owner decisions, with recoverable operations; not a claim of a completed hosted write.

## Initial independent checks

The conductor ran these commands, each exit 0:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/decision-context.test.mjs tests/decision-context-reader.test.mjs tests/decision-brief.test.mjs tests/shaping.test.mjs
node --import ./tests/helpers/hermetic.mjs --test tests/web-decisions.test.mjs tests/web-operations.test.mjs tests/web-decision-ui.test.mjs tests/web-server.test.mjs tests/web-auth.test.mjs tests/web-access.test.mjs tests/web-home.test.mjs tests/web-events.test.mjs tests/web-store.test.mjs tests/board.test.mjs
npm run typecheck
```

The context run passed 31/31; the web/regression run passed 112/112. These preceded
the independent identity review finding below and are not the final-tree result.
The immutable reader was checked against local filesystem results, including
exact digest parity, accepted/proposed distinction, supersession, unavailable
inventories, missing references, bounds and revision changes.

The integrated gate is `npm run check`: tests, roadmap, render and inbox guards.
Its result belongs to the later integration/commit record. It has not been run
for phase 97 at this evidence checkpoint.

## SQL proof

```sh
node docs/evidence/2026-10-21-web-decisions-sql-proof.mjs /absolute/tooling/node_modules/@electric-sql/pglite/dist/index.js
```

The conductor used PGlite 0.5.11 installed outside the application. The first
run found PostgreSQL error 42702: a PL/pgSQL variable named `preview` collided
with its table column. The initial rename missed one `SELECT INTO`; the next
load caught it. After both corrections, the same proof exited 0.

Migration 004 SHA-256 at this proof:
`cfe712281521b2d5bdf1c74117a78d818ecada1aeda76449de6de67b19b00459`.
The [SQL assertions](2026-10-21-web-decisions-hosted-proof.sql) checked actual
role denials and RLS, immutable scoped previews, original replay identity,
project reservations, wrong fences, expired preparation, persistent dispatched
and uncertain reservations, terminal receipts, independent preview expiry and
rollback of synthetic data. This is a single-connection isolated PostgreSQL
proof, not hosted or overlapping-connection evidence.

Applying the migration through the existing Vercel/Supabase query editor reached
“Verify to Access Database”, requiring a fresh authenticator code. No successful
migration result was observed. The older success notice was from migration 003;
it is not evidence for 004. The owner was asked to supply the code through the
previously approved temporary-file handoff. Hosted role and concurrency checks
remain pending.

## Review correction

Independent review reproduced a P1 identity defect: after a repository rename,
recovery followed the old repository name and accepted matching cloned history
without checking numeric identity. The same name-based dispatch could target a
reused name after validation. The source contract now requires repository and
branch node identity, ID-addressed mutation and identity-bound recovery. The
correction and its regression must be verified before delivery.

The correction was then independently verified: the old-name clone remained
uncertain, while the pinned repository's actual matching commit recovered with
one write total. No remaining actionable local review finding was reported.
The conductor reran the four decision/UI/server test files: 42/42, exit 0,
and `npm run typecheck`: exit 0. The new cases cover recycled names, a rename
after final validation, deleted Refs, mismatched identities and unavailable
changed-file counts.

The conductor also executed the production `DecisionRepository`,
`DecisionHistory` and `DecisionCommitProof` GraphQL query strings through
`gh api graphql` against the public Keel repository. All three returned
successfully with consistent repository/Ref identity, source
`47f3043948260d764b83bc5ff83d8bef6f5e308f`, 100 bounded history entries and a
nontruncated README blob. This verifies actual query fields using the existing
CLI credential; it does not verify App-token GraphQL permission or a mutation.

Actual installed Vercel Node File Trace also exited 0: 273 files, no excluded
development/source-data trees, Home and decision browser modules included. It
reported 45 nonfatal warnings; a successful production deployment remains a
separate required check. The npm-package HTTP regression passed in the 42-test run.

Delivery uses `codex/phase-97-decisions` so the configured cross-review workflow,
which infers authorship from the branch prefix, selects the other provider for
the actual Codex-authored change. This adapts the conductor skill's literal
`claude/` example while retaining its required practice PR and independent review.

## Browser observations

The conductor used the actual service routes, renderers and browser modules with
the synthetic Acme HTTP/provider/storage test harness on loopback. A visible
banner identified synthetic data and writes were disabled. This proves browser
layout and interaction only, not hosted authentication, database persistence or
a GitHub write. The temporary harness initially retained the loopback Host header
while mapping the origin and was correctly refused; fixing that test harness
header required no application change.

| Action | Observed | Scope |
| --- | --- | --- |
| Open health decision | Both radio choices unselected; owner reason separate; submission-disabled notice | Browser rendering |
| Choose decline, type a reason and press Enter to preview | Exact resulting file and full operation-marked message shown; focus moved to preview heading | Browser interaction |
| Inspect public preview | Public destination/consequences shown; acknowledgement and Publish button disabled | Preview-only controls |
| Set mobile viewport and inspect DOM | clientWidth and scrollWidth both 360; Tab reached complete-file panel with visible focus | Browser layout/keyboard, not a physical phone |
| Inspect desktop DOM | clientWidth and scrollWidth both 1280 | Browser layout |
| Open shaping question | Empty answer; author's recommendation/evidence/alternatives separate | No default owner choice |
| Preview an answer different from recommendation | Revision 2, explicit answer, original recommendation and proposed decision preserved; submission still disabled | Synthetic browser preview |
| Edit the answer after preview | Old preview removed, typed answer retained and fresh preview available | Browser interaction |

Screenshots remain outside the public repository:
`/tmp/keel-decision-preview-desktop.jpg` and
`/tmp/keel-decision-preview-mobile.jpg`. They contain synthetic Acme data.

## Gaps and decision

No real owner choice or broader GitHub Contents-write approval has been supplied.
No decision write has been attempted against a real repository. Hosted migration,
concurrent SQL proof, required practice PR review and production walkthrough remain
open. The existing read-only Home is still the serving application; this evidence
does not establish phase 97 as built or lived-in.
