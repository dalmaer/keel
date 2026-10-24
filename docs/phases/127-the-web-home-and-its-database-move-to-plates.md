---
status: planned
since: 2026-10-23
goal: G2
spec: 2
depends: [124]
note: "Specified 2026-10-23 (docs/specs/name-transition.md). The hosted home's cookies, env, headers and database functions move to plates names with forwarding for the old ones, so no session ends and no deployed build loses a function it calls."
evidence: []
issue: 243
---

# The web home and its database move to plates names without logging anyone out or losing a row

## Done when

The web home issues `__Host-plates-session/login/oauth`, reads `PLATES_WEB_ORIGIN/OPERATION`, sends `Plates-Operation` and `Plates-Update-Operation`, and calls `plates_*_rpc` functions. Throughout, a browser with an old cookie stays signed in, and a deployed build that still calls `keel_*_rpc` keeps working until retirement.

## Scope

The design is [Name transition](../specs/name-transition.md), "Hazards".

- **Cookie rollout has two release stages.** First ship and, with owner approval, deploy a compatibility baseline that reads both session, login and OAuth cookie names while keeping legacy writers. Pin and verify that deployed baseline as the rollback target before shipping the writer cutover. A new-writer build must not be activated while its rollback target understands only legacy cookies. This phase remains partial until both stages are verified; a source merge alone does not verify the baseline deployment.
- **Cookies after that barrier:** read plates first and keel second as one session/flow. Re-issue a legacy-only session cookie under the plates name with the same remaining expiry, without renewing idle or absolute authority, then clear its old name. The compatibility baseline must also consume the plates cookie after rollback, including login CSRF and an OAuth callback that began on the new build. Logout/revocation invalidates the session or flow once and clears both cookie names so an alias cannot revive it. Identical aliases are consumed once; conflicting aliases refuse without silently choosing an identity.
- **Activation is a reviewed source change, not a new runtime permission.** The compatibility release keeps cookie and RPC rows `held`; implementations select writers through those exact rows. After the owner verifies the deployed rollback baseline and hosted migration, a separately reviewed change moves only those rows to `dual`. Prepare and test the cutover implementation while the shipped rows remain held. No environment flag or self-issued receipt activates it.
- **In-flight expiry:** the authenticated session has a server-owned absolute expiry, so an alias response uses only its remaining lifetime and adds no renewal. Login CSRF and OAuth cookies do not return their browser expiry; consume those existing flows under either name once and clear both aliases when the flow ends. Do not reissue an unconsumed legacy flow with an invented lifetime. A fresh owner-initiated flow uses the selected writer and clears its alternate alias.
- **Env:** read `PLATES_WEB_*`, else `KEEL_WEB_*`. When both are set and differ, refuse to start, naming both. Setting the Vercel values is phase 128's.
- **Headers:** send `Plates-Operation`, accept either, and refuse a request that carries both with different values. `trusted-keel` follows the same rule.
- **Database:** migration `NNN-plates-names.sql` creates each `plates_*_rpc` with the same body and grants, and turns each `keel_*_rpc` into a one-line forwarder. It runs in a transaction and is re-runnable. `keel_run_history`, `keel-job-migrations` and their peers are handled the same way, or kept as internal names (see Open).
- **The `keel_private` schema:**
  - Measure what renaming it costs on the hosted database: locks, dependent views, grants and the forwarders it would need.
  - Then decide between renaming it now behind a forwarding view, renaming it at retirement, or keeping it as an internal name nobody sees.
  - Record the decision in the phase.

## Acceptance

- [ ] A session from a keel cookie is still signed in after the upgrade and leaves with a plates cookie. One request carrying both is read once. `tests/web-auth.test.mjs`: "a keel session survives, and leaves as a plates one"
- [ ] An upgrade to new cookie writers followed by rollback to the pinned compatibility baseline preserves the authenticated session, login CSRF and an in-flight OAuth callback without renewing expiry; revocation/logout cannot revive an old alias. A legacy-only rollback target refuses writer activation. tests/web-auth.test.mjs: "cookie cutover survives rollback to the compatibility baseline"
- [ ] With only `KEEL_WEB_*` set the home starts; with both set and different it refuses, naming both. `tests/web-config.test.mjs`: "web env under both names"
- [ ] After the migration, a build calling `keel_*_rpc` and one calling `plates_*_rpc` get the same rows, and re-running the migration changes nothing. `tests/web-migrations.test.mjs` (pglite): "renamed functions with forwarders"
- [ ] The owner applies the migration to the hosted database. A build on the old names and one on the new both serve, and the evidence shows both answers. ⚑ by hand: the owner

## Your part

- **Ask:** First deploy and verify the compatibility-reader baseline and record its revision as the rollback target; then approve the new-writer build and database update, and verify upgrade and rollback session/OAuth continuity.
- **Why:** The hosted database is yours, and plates never changes it on its own.
- **Look at:** the migration file and its dry-run output in the evidence.
- **Choices:** Applied and fine | Something broke
- **Takes:** 10 minutes.
- **Then:** Something broke: roll back to the verified compatibility baseline, not an arbitrary legacy-only release. Keep the database forwarders.
- **Ready when:** this phase's automated boxes are checked.

## Real surfaces

- published package: the web home build on Vercel, old and new side by side during the switch.
- owner's machine: the owner's browser session and its cookies.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/web-auth.test.mjs tests/web-config.test.mjs tests/web-migrations.test.mjs`; `npm run check`.
By hand: ⚑ the owner applies the migration, and checks both builds and their own session.

## Deliberately open

- **2026-10-24 — Cookie expiry and activation settled by source inspection.** `auth.mjs` retains `absoluteExpiry` for sessions; login cookies contain an opaque CSRF token without expiry metadata, and OAuth callbacks consume their original server attempt. Preserve those flows through dual readers rather than resetting a browser lifetime. Prepare table-selected new writers behind held rows; the owner-approved deployment and migration precede a separate reviewed row transition. This is implementation design, not evidence that any hosted prerequisite passed.

- **`keel_private` and internal table names** may stay as they are. Nobody sees them, and renaming a schema under a live database is the riskiest step here. The measurement decides.

## Next action

List every `keel_*_rpc` and its grants from `lib/web/migrations/`, and draft the forwarding migration against pglite.

Cookie activation prerequisite: prepare the compatibility-reader baseline and its session/login/OAuth rollback tests first. Do not activate new cookie writers before the owner verifies that baseline as the rollback target.
