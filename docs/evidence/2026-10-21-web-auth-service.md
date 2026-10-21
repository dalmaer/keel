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
