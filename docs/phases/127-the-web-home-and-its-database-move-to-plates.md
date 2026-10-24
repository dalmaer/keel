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

- **Cookies:** accept the keel cookie or the plates cookie. When a request carries only the keel one, re-issue it as the plates one with the same expiry and clear the keel one. The OAuth state cookie follows the same rule within one flow.
- **Env:** read `PLATES_WEB_*`, else `KEEL_WEB_*`. When both are set and differ, refuse to start, naming both. Setting the Vercel values is phase 128's.
- **Headers:** send `Plates-Operation`, accept either, and refuse a request that carries both with different values. `trusted-keel` follows the same rule.
- **Database:** migration `NNN-plates-names.sql` creates each `plates_*_rpc` with the same body and grants, and turns each `keel_*_rpc` into a one-line forwarder. It runs in a transaction and is re-runnable. `keel_run_history`, `keel-job-migrations` and their peers are handled the same way, or kept as internal names (see Open).
- **The `keel_private` schema:**
  - Measure what renaming it costs on the hosted database: locks, dependent views, grants and the forwarders it would need.
  - Then decide between renaming it now behind a forwarding view, renaming it at retirement, or keeping it as an internal name nobody sees.
  - Record the decision in the phase.

## Acceptance

- [ ] A session from a keel cookie is still signed in after the upgrade and leaves with a plates cookie. One request carrying both is read once. `tests/web-auth.test.mjs`: "a keel session survives, and leaves as a plates one"
- [ ] With only `KEEL_WEB_*` set the home starts; with both set and different it refuses, naming both. `tests/web-config.test.mjs`: "web env under both names"
- [ ] After the migration, a build calling `keel_*_rpc` and one calling `plates_*_rpc` get the same rows, and re-running the migration changes nothing. `tests/web-migrations.test.mjs` (pglite): "renamed functions with forwarders"
- [ ] The owner applies the migration to the hosted database. A build on the old names and one on the new both serve, and the evidence shows both answers. ⚑ by hand: the owner

## Your part

- **Ask:** Apply the database update to the hosted home when asked, and confirm the home still loads and you're still signed in.
- **Why:** The hosted database is yours, and plates never changes it on its own.
- **Look at:** the migration file and its dry-run output in the evidence.
- **Choices:** Applied and fine | Something broke
- **Takes:** 10 minutes.
- **Then:** Something broke: the forwarders mean the old names still work, so roll back the new build, not the database.
- **Ready when:** this phase's automated boxes are checked.

## Real surfaces

- published package: the web home build on Vercel, old and new side by side during the switch.
- owner's machine: the owner's browser session and its cookies.

## Proof

Automated: `node --import ./tests/helpers/hermetic.mjs --test tests/web-auth.test.mjs tests/web-config.test.mjs tests/web-migrations.test.mjs`; `npm run check`.
By hand: ⚑ the owner applies the migration, and checks both builds and their own session.

## Deliberately open

- **`keel_private` and internal table names** may stay as they are. Nobody sees them, and renaming a schema under a live database is the riskiest step here. The measurement decides.

## Next action

List every `keel_*_rpc` and its grants from `lib/web/migrations/`, and draft the forwarding migration against pglite.
