# Run the private web sign-in service

Phases 95–96 provide a framework-free service with responsive sign-in and a
read-only [Home board](web-home.md) for authorized projects. Phases 97–98 add
[decision review](web-decisions.md) and [guided walks](web-walks.md), with source
writes disabled by default. Media remains planned. This guide describes the
service contract; it is not evidence that an instance has been deployed or that
its owner has completed a real login.

## Private records and identity bindings

Keep the version 1 workspace manifest from the
[workspace setup guide](web-workspace-setup.md) in the approved private repository.
Add a separate membership file there, for example `members.json`:

```json
{"version":1,"workspaceId":"acme","memberIds":[1]}
```

Use actual numeric GitHub user IDs. Names do not confer membership. The service
fetches the manifest and membership file at the same current default-branch
commit through the signed-in user's GitHub App token. The private repository
must remain private and accessible through the selected App installation.

Set `PLATES_WEB_CONFIG` to an explicit JSON object in the production deployment:

```json
{
  "version": 1,
  "origin": "https://plates.example.com",
  "ownerIds": [1],
  "appId": 11,
  "clientId": "replace-with-github-app-client-id",
  "installationId": 21,
  "workspace": {
    "id": "acme",
    "repoId": 101,
    "manifestPath": "workspace.json",
    "membersPath": "members.json"
  },
  "projectRepoIds": { "studio": 102 }
}
```

These are synthetic identities. Read actual IDs from GitHub when configuring an
instance; never copy the example IDs into production. `projectRepoIds` pins each
manifest project ID to an approved numeric repository ID. A deleted repository
recreated at the same name does not inherit access. Rename/transfer mismatches
fail closed until the manifest and approved bindings are reconciled. Projects
outside the explicit manifest, installation, pins or current user access are
omitted; direct requests are denied. No ambient checkout or CLI fleet is read.

The GitHub App must use selected repositories, with Metadata read and Contents
read. Set its callback to the exact configured origin plus
`/api/auth/callback`. Enable expiring user tokens. This phase uses GitHub App
user-to-server OAuth, so it needs a client secret but no installation private key
or token. The service checks the installation's numeric App ID on every request.
A provider failure is never an empty successful workspace.

## Secrets and database migration

Set these only in the production deployment's secret store:

| Variable | Purpose |
| --- | --- |
| `PLATES_GITHUB_CLIENT_SECRET` | GitHub App OAuth code exchange |
| `SUPABASE_URL` | Explicit HTTPS Supabase project origin; Marketplace name supported directly |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only PostgREST authentication; Marketplace name supported directly |
| `PLATES_SESSION_ENCRYPTION_KEY` | Base64 encoding of 32 cryptographically random bytes for AES-256-GCM |

Generate the encryption key directly into the approved secret store without
printing it or saving it in Git. Neither the anon key nor a frontend key can
replace the service role credential. Environment bindings are explicit: the
service does not read `.env` files or infer another database. Vercel preview
and development environments fail closed; real credentials are production-only.

Apply [001-auth.sql](../../lib/web/migrations/001-auth.sql),
[002-home-cache.sql](../../lib/web/migrations/002-home-cache.sql) and
[003-home-retry.sql](../../lib/web/migrations/003-home-retry.sql), in that order,
to the selected private Supabase database through its owner SQL interface before
starting the service. Home requires all three migrations. Decision previews and
receipts add [004-decision-operations.sql](../../lib/web/migrations/004-decision-operations.sql)
after those migrations; this does not enable GitHub writes. The optional boolean
`decisionWrites` in `PLATES_WEB_CONFIG` defaults to disabled. Enable it only after
owner approval of App Contents-write access and the intended decision workflow.
See [Review and record a decision](web-decisions.md). Guided walks additionally
require [005-walk-drafts.sql](../../lib/web/migrations/005-walk-drafts.sql), after
004. It stores encrypted, versioned private observations and uses the same project
reservation as source operations, so saves cannot race an acceptance commit.
The shared `decisionWrites` opt-in also controls walk submission; migration alone
does not enable it. Verify hosted SQL role and concurrency behavior separately
from local adapter tests. See [Guided walks](web-walks.md).
Optional private captures add
[006-private-media.sql](../../lib/web/migrations/006-private-media.sql) and an
explicitly approved private bucket and retention policy; follow
[Visual changes and private captures](web-changes.md#configure-the-optional-adapter).
Routine history adds [007-run-history.sql](../../lib/web/migrations/007-run-history.sql)
after 004. It reads minimal actor/project-scoped operation summaries without
recovering or changing their state. It does not require media activation.
Actions history additionally needs the owner-approved App **Actions: read**
grant on the selected repositories; missing permission remains a visible gap.
See [Routines and observed activity](web-routine-history.md).

Apply only the migrations for the approved features, preserving their named
prerequisites. Each migration is transactional and can be reapplied. Vercel’s Marketplace query
editor accepts one prepared statement: wrap the migration body (without its
outer `begin;` and `commit;`) in `DO $plates_migration$ BEGIN ... END
$plates_migration$;`. This keeps schema creation and permission changes atomic;
do not run its statements individually. Migration 001 creates a private,
RLS-enabled table and a narrowly scoped `public.keel_web_rpc` function. The
function has an empty search path and fully qualified table references. Public,
anon and authenticated roles cannot execute it or read the table; service_role
can execute the RPC but has no direct table grants. Verify those grants against
the actual database after applying; synthetic adapter tests do not establish
hosted database behavior.

The RPC atomically creates, reads, consumes, renews, revokes and updates versioned
records. Its single-use consume checks the browser binding in the same DELETE.
CAS writes require the current version. Revocation deletes server state, so a
competing renewal cannot recreate it. Payloads are encrypted with per-record
associated data; opaque browser cookies are stored only as SHA-256 keys.

Authorization attempts expire after ten minutes; sessions idle out after thirty
minutes and expire absolutely after at most eight hours (or the provider's
shorter token lifetime). Refresh tokens are discarded. A new login rotates the
session; changed project privileges require a fresh login. Logout deletes the
current session; `POST /api/auth/revoke` with the current CSRF token revokes all
sessions for that numeric user in this instance. These are local session
revocations; GitHub's separate App authorization remains under the owner's
GitHub settings.

Each create transaction removes at most 100 expired rows of its record kind.
Hard capacities are 1,000 attempts, 1,000 sessions and 10,000 versioned records;
capacity exhaustion denies writes. A short per-kind database advisory lock
serializes this bound across instances without holding a lock during network
calls. These limits bound storage; they are not a distributed per-client rate
limiter. Configure host abuse controls before broad exposure, and arrange owner
maintenance for quiet expired records:

```sql
delete from keel_private.web_records where expires_at <= clock_timestamp();
```

No recurring paid job is created by the application. Back up private shared Git
records separately. Restore must discard attempts and sessions and reconcile
future durable operations before replay; do not treat encrypted session rows as
records to preserve indefinitely. Replacing the encryption key makes existing
sessions unreadable; explicitly delete attempts/sessions during key rotation.

## Vercel and extracted-package launch

The repository includes `api/index.mjs` and `vercel.json`: native Node Web Handler,
no build step or runtime dependencies. Use the selected Node 24.x runtime and
verify the actual serving patch is at least 24.22.1. Route all requests through
the handler on the approved HTTPS origin. No static app asset contains secrets;
there is no unauthenticated service status endpoint exposing configuration.
The authenticated `GET /api/session` response includes `runtime` for verification.

For a packed installation, extract the package, store the nonsecret config JSON
in an explicit absolute path outside the extracted application, with mode 0600,
and inject the four secret bindings into the process environment. Then run:

```bash
node /absolute/package/lib/web/serve.mjs --config /absolute/private/instance.json --port 3000 --json
```

The launcher binds only `127.0.0.1`; port `0` requests an OS-assigned port and
the startup JSON reports it. Put an HTTPS reverse proxy for the exact
configured origin in front of it and preserve that Host header. Secure cookies
require HTTPS; a local HTTP listener alone is not a working browser login.
Startup emits one bounded JSON line and sanitizes failures. It never starts with
an inferred config, a local session file or an in-memory production store.

## Verify before relying on it

Run the four focused test files named in
[phase 95](../phases/95-sign-in-scopes-every-project.md), then verify actual owner
login, logout, denied-project access and serving runtime on the approved origin.
Test an owner outside workspace membership and a removed project/App permission.
Confirm replay and cross-origin mutation refusals. Restore the intended approved
membership/access afterward. Never publish OAuth codes, browser cookies, tokens
or secret environment output as evidence.

`GET /signin` is public. `POST /api/auth/start` requires the browser's pre-login
CSRF token and exact Origin. Responses use `Referrer-Policy: strict-origin` so
native browser forms retain that Origin; `no-referrer` makes it null and fails
the deliberate origin check. Do not relax the check to accept null. GitHub redirects to the single-use, browser-bound
callback with PKCE S256. All protected reads recheck GitHub identity, membership,
private source and repository access; there is no cached authorization grant.
The list is bounded to 1,000 repositories/installations and ten pages; incomplete,
duplicated or changing pagination denies access instead of reporting partial
coverage as complete. Provider calls have eight-second limits and a shared
25-second access-read deadline. Unavailable storage fails closed.

`GET /` and `/projects/:id` render Home through the fleet or project lens.
`GET /api/home` and `/api/projects/:id/home` expose the bounded read model with
ETags and cursors; `fresh=1` requests revision revalidation subject to the shared
cooldown and provider quota. `/api/session` and `/api/projects/:id` expose current
authorized connection details. See [Home](web-home.md) for cache bounds and gaps.
`/api/projects/:id/media/:id` and `/api/projects/:id/stream` check the same access
boundary, then explicitly report that the feature is unavailable. They do not
serve invented media or events. Future mutation handlers must use both the exact
Origin check and the session CSRF token before touching a source record.
