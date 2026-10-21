# Evidence: phase 95 — private sign-in service implementation

- Date: 2026-10-21.
- Phase: [Sign-in scopes every project](../phases/95-sign-in-scopes-every-project.md).
- Revision: base `1443af4`, phase 95 working tree; implementation is in the accompanying commit.
- Claim: the implemented service passes local access, session and package checks. This is not a deployed login or a built/lived-in claim.
- Decision context: `not-configured`, digest `b72f7ff361d9a2d6b30291d633dd4f93341fe63d48bb0d11bc4db81b8e67abb9`; legacy behavior, not verified decision coverage.

## Automated checks

The conductor independently ran:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-auth.test.mjs tests/web-access.test.mjs tests/web-server.test.mjs tests/web-store.test.mjs
npm run typecheck
```

Both exited 0. Focused proof: 19 tests, 19 passed, 0 failed, 0 skipped.
The package test runs `npm pack --ignore-scripts --json --pack-destination <temporary-dir>`, extracts the actual archive and launches its HTTP service with an external mode-0600 config. It checks the sign-in response and cookie flags through the real loopback HTTP boundary. Runtime was Node v26.12.0 locally; this says nothing about the deployed Node patch.

The four files cover browser-bound single-use PKCE attempts, unsafe return paths,
rotation, idle/absolute expiry, logout/revocation, fresh membership/installation
checks, removed/replaced/renamed repositories, denied project/media/stream paths,
CSRF/origin checks, incomplete and duplicated pagination, unavailable storage,
encrypted payload binding, and packed output. Independent application instances
use a shared synthetic HTTP provider; these tests do not execute PostgreSQL.

The conductor also ran the actual migration in PGlite 0.5.11, installed only in a
temporary directory outside the application. Reproduce with a separate temporary
tooling directory (this is not a runtime or repository dependency):

```sh
npm install --prefix /absolute/temporary-tooling --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.11
node docs/evidence/2026-10-21-web-auth-sql-proof.mjs /absolute/temporary-tooling/node_modules/@electric-sql/pglite/dist/index.js
```

Observed command used `/tmp/keel-sql-proof.ja5XRq` as that tooling directory and
exited 0. The [retained proof script](2026-10-21-web-auth-sql-proof.mjs) executes
the migration, verifies role denials, unique create, browser-bound consume,
stale CAS rejection, expiry, scoped revocation, RLS, capacity denial and bounded
expired cleanup. PGlite has one connection: this does **not** prove competing
PostgreSQL connections or Supabase deployment. The attempted local Docker
runtime was unavailable; no concurrency result is inferred from it.

An independent code review found no actionable defects. Review is supplementary,
not acceptance evidence.

The first `keel integrate --json` on `7a89f36` ran `npm run check` once and
returned exit 1: 1,923 tests, 1,921 passed, 2 failed. Both failures were the same
repository integration defect: `vercel.json` introduced Vercel stack evidence
without declaring `vercel` in Keel's own stack configuration. The failing checks
were the CLI JSON contract test and self-doctor test. Nothing landed. The ledger
reported no flaky or slower test (the run was classified busy). This is a real
metadata correction, not a retry of an unexplained failure. The corrected final
tree receives a new integrated gate; its result is recorded after that gate.

Correction `4a8edf4` declares the Vercel stack and regenerates the selected lesson
view and its lock hash. No application code changed. The conductor independently
ran the exact two failing checks after that correction:

```sh
node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='--json parses for every verb and flag|keel itself is clean under its own doctor' tests/cli.test.mjs tests/doctor.test.mjs
```

Exit 0: 2 tests, 2 passed. The renderer consistency check is included in the
corrected branch's fast handoff checks.

The second integrated gate on `d5b8001` returned exit 1: 1,923 tests, 1,922
passed, 1 failed. The remaining failure was `tests/stacks.test.mjs:135`, which
hard-coded Keel's own stack before Vercel was added. The self-doctor and CLI
contract checks passed in this full run. No flaky or slower test was reported,
and nothing landed. The explicit Keel-owned expectation is updated to include
Vercel; synthetic Acme projects retain their own two-tag expectations and the
lesson filtering/staleness assertions remain intact.

Correction `2446891`: the conductor independently ran
`node --import ./tests/helpers/hermetic.mjs --test tests/stacks.test.mjs`;
exit 0, 8/8 passed. The corrected tree is handed off for its final integrated gate.


## Visual review and exploration

The actual `signinView` and CSS were served on a temporary loopback presentation
server. Browser captures at 1365×900 and 390×844 showed readable content, an
unclipped button and a responsive header. No authentication backend was attached
to this presentation server; the button was not used as a login proof.

- [Desktop capture](web-auth/signin-desktop.jpg).
- [Mobile capture](web-auth/signin-mobile.jpg).
- [Service setup and real launch instructions](../guide/web-auth-service.md).
- [Home interaction prototype](../design-previews/keel-home.html), synthetic planning examples, not the authenticated service.

Explore the captures by checking the GitHub entry point, mobile text wrapping,
and keyboard skip-link in a locally launched instance. A live preview/try URL
is unavailable because the App and database owner verification remain pending.
The temporary presentation server is not a deployable preview or login endpoint.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Extracted package launch over HTTP | Explicit config, sign-in response, secure cookie attributes | Passed in focused package test | Packaged entry point works locally; no HTTPS login proof |
| Desktop/mobile presentation review | Readable responsive sign-in | Captures retained above | Layout only; not a real device or authenticated journey |
| GitHub App registration | Approved read-only selected-repository App | GitHub requires owner Confirm access | No App ID/client secret/installation yet |
| Supabase owner SQL access | Apply migration and test concurrent connections | Vercel requires owner database identity verification | Hosted migration and role/concurrency checks not run |
| Approved HTTPS origin | Login, logout, denial and serving Node >=24.21.0 | Not deployed; not run | No production or live acceptance claim |

## Gaps and decision

Phase 95 remains **partial**. The SQL concurrency acceptance box stays open;
synthetic adapters and a single embedded database connection are insufficient.
Complete the two owner identity checks already requested, then apply the
migration, test two independent database connections, configure approved
production secrets, deploy and verify owner login/logout/denied access.
Do not expose tokens, cookies, OAuth codes or production environment values in
public evidence. Exact resource and identity bindings remain in the private
workspace repo. Phase 94 also retains its unresolved backup and connection walk.


## Hosted follow-up — 21 October 2026, 16:59–17:01 UTC

This dated follow-up supersedes the pending identity/database observations above;
those earlier observations are retained as history. Application source remained
`9202f9e`. The final preceding integration on that revision passed: `npm run check`
exit 0, 1,923/1,923 tests, and `npm run typecheck` exit 0.

The owner completed GitHub and Vercel identity checks. GitHub App registration is
verified, with the two selected repositories prepared for installation; the
final access grant and OAuth client secret remain pending. No private key was
created. Exact identities remain in the private workspace setup record.

The conductor used Vercel’s authenticated database editor against the approved
Supabase instance. Preflight found no auth table or function. The editor rejected
the multi-statement migration with “cannot insert multiple commands into a
prepared statement”; no migration success was inferred from that attempt. The
same migration body, without its outer transaction statements, then succeeded in
one `DO $keel_migration$ BEGIN ... END $keel_migration$;` statement. Its single
statement transaction preserves atomicity. Migration source was
`lib/web/migrations/001-auth.sql` at `9202f9e`.

Live catalog checks found RLS enabled, SECURITY DEFINER enabled, an empty function
search path, no schema/table/RPC access for anon or authenticated, and only RPC
execution for service_role (no direct table access). The retained role assertion
block actually attempted those reads/calls under each role: forbidden calls
raised insufficient_privilege; service_role read the synthetic record via RPC.
The block completed successfully.

The [exact hosted SQL proof](2026-10-21-web-auth-hosted-proof.sql) uses only
random-keyed synthetic Acme records with ten-minute TTLs. Each A query holds its
transaction for eight seconds; B starts while A is still active. Observed UTC
intervals and distinct `pg_backend_pid()` values establish real overlap:

| Race | A backend / interval | B backend / interval | Observed |
| --- | --- | --- | --- |
| Consume one attempt | 16613 / 16:59:00.186–16:59:08.259 | 16681 / 16:59:00.596–16:59:08.388 | A returned version 1; B returned null |
| CAS from version 1 | 16681 / 16:59:25.124–16:59:33.190 | 16613 / 16:59:25.454–16:59:33.331 | A wrote version 2; B returned null; A’s value persisted |
| Renewal versus revocation | 16613 / 16:59:59.719–17:00:07.788 | 16681 / 17:00:00.057–17:00:07.914 | Renewal completed, revocation waited then deleted; a subsequent renewal returned null |

All four final SQL assertions returned true: consumed attempt absent, winning
CAS value preserved, revoked session absent, late renewal denied. Cleanup removed
exactly the one remaining synthetic record; no owner records were touched. Both
editors were restored to read-only. This establishes the actual hosted SQL
boundary alongside the independent application-instance adapter tests above;
it is not a deployed Vercel function or end-to-end OAuth claim.

The production session encryption secret was generated directly into Vercel’s
secret store via CLI stdin; exit 0, addition confirmed. No value was printed,
saved locally, or committed. Temporary owner verification-code files were removed
after use. Public evidence contains no codes, cookies, tokens or live secrets.

Phase 95 remains **partial** for App installation/client secret, deployment,
owner login/logout/denied access and actual serving Node version. Its database
concurrency acceptance box is now checked. Phase 94 still owes fresh installation
API facts and the backup destination. A live service preview remains unavailable
until those deployment prerequisites are completed.

## Production follow-up — 21 October 2026, verified by 18:21 UTC

This follow-up supersedes the pending App/deployment observations above. The
owner approved installation on the exact two selected repositories and production
storage of the OAuth client secret. Installation succeeded with Contents read
and Metadata read. The secret was transferred directly to Vercel CLI stdin,
without a local secret file or printed value. No App private key was generated.
Exact resource IDs, origin, config and deployment receipts remain in the private
workspace setup record; public fixtures remain synthetic.

A clean `git archive` of `223a628` was deployed with Vercel CLI 65.0.0:

```sh
vercel deploy --prod --yes --regions iad1 --project <approved-project-id> \
  --scope <approved-team> --global-config <existing-auth-config> \
  --no-color --meta sourceCommit=<archived-revision> --json
```

Exit 0, READY, approved production alias assigned. The actual browser sign-in
form then failed `invalid_origin`. An independent HTTP request with explicit
correct Origin succeeded with 303 to GitHub, identifying a browser/header gap:
`Referrer-Policy: no-referrer` makes native non-CORS form POST Origin null. The
fix uses `strict-origin`, retaining exact Origin and CSRF validation while
excluding paths and query strings from referrers. The header regression and
foreign/null/missing Origin plus bad CSRF refusals are tested. A manually supplied
Origin alone cannot establish browser compatibility.

The conductor independently ran, exit 0 (10/10 tests):

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-server.test.mjs tests/web-auth.test.mjs
node bin/keel.mjs prove tests/web-server.test.mjs --name 'public signin/assets' --fix lib/web/server.mjs --base 223a628 --trailer
npm run typecheck
```

`prove` returned VERIFIED: the policy assertion failed without the fix and passed
with it. This is a header regression proof, not a simulated browser. Fix revision
`0805f16c8dcbef8d3cef7ca65fa29fec38e8b466` was deployed from a new clean archive with
the same command, exit 0, READY. No untracked local records were uploaded.

The conductor walked the actual HTTPS deployment in the owner's authenticated
browser, completing the previously approved GitHub login. Observed:

| Action | Observed |
| --- | --- |
| Native Continue with GitHub form | GitHub authorization page, then authenticated connected-project list |
| Authenticated `/api/session` | Current private source revision and selected project; serving Node `v24.21.0`; CSRF omitted from retained output |
| Open an unconnected project path | Generic unavailable page, `access_denied`; no project records |
| Sign out, then reopen Home | Sign-in required; old browser session unavailable |
| Fresh login, temporarily remove owner from private membership | Existing session denied on next request |
| Restore membership, retry old session | Still sign-in required; restoration does not resurrect revoked session |
| Fresh login, temporarily remove project from private manifest | Previously authorized project denied; changed scope invalidates old session |
| Restore approved manifest | Original project and member records restored and pushed |

The reversible removal checks changed only the named membership/project records;
restoration commits are retained privately. Provider grants were not widened.
Successful protected requests exercise fresh GitHub App API reads for user,
selected installation, repository access, workspace privacy and manifest/membership
at one source commit. A personal CLI token's `/user/installations` request was
rejected because it was not an App user token; no false API proof is inferred
from it. The actual service flow provides that boundary proof.

The live connected-list screenshot is retained privately, not copied into the
public repository with the owner's workspace details. It is a connection
scaffold; the attention board and write actions remain future phases. Phase 95
is **built**, not lived-in. Phase 94 still owes an independent backup/restore
destination. The final combined integration gate result follows in the next
record, as required for checks whose result depends on the committed tree.
