# Set up a private Keel web workspace

Design/setup worksheet, 21 October 2026. Phase 93 provides local manifest and
state initialization. Hosted login and Home are subsequent phases, not commands
you can run today. See [the contract](../specs/web-workspace.md).

## Prepare the local data boundary

Keep three separate locations, for example (illustrative Acme paths):

- `/srv/keel/app`: installed public application, read-only in deployment.
- `/srv/keel/workspace/workspace.json`: manifest in a private repository checkout.
- `/srv/keel/state`: private persistent runtime directory, outside any Git tree.

The paths are explicit; the runtime directory's parent must exist. Do not put
credentials in the manifest. Create the version 1 manifest from the contract,
then use the built phase 93 commands:

```sh
keel workspace inspect --manifest /srv/keel/workspace/workspace.json --state /srv/keel/state --json
keel workspace init --manifest /srv/keel/workspace/workspace.json --state /srv/keel/state --json
keel workspace init --manifest /srv/keel/workspace/workspace.json --state /srv/keel/state --yes --json
```

Preview exits 3 and writes nothing. Explicit initialization is idempotent for
the same identity. Remote privacy remains unverified until checked through
GitHub. This does not create a repository, host a service or authenticate anyone.

## Selected host: Vercel (21 October 2026)

The owner selected Vercel and a private workspace repository. The repository
was created and its privacy read back through GitHub. The owner subsequently
authenticated and selected an existing Pro team. The Vercel project is created;
its assigned domain and Node 24.x setting were read back. No application is
deployed, and no database, Blob store or GitHub App has been provisioned yet.
Exact account, project and domain identifiers live in the private workspace repo.
The earlier Render single-instance candidate was not approved or created and is
superseded by this choice. The local filesystem adapter above remains supported;
it is not the storage implementation for hosted requests.

| Layer | Proposed binding | Remaining decision/check |
| --- | --- | --- |
| Application | Public Keel source; framework-free Node functions and browser modules | Account/team and project verified; region and actual Node >=24.21.0 remain |
| Shared records | Owner-selected private GitHub repository | Numeric identity retained privately; manifest and selected project list |
| Sessions/drafts/receipts | Supabase Postgres via Marketplace, Free trial proposed | Owner approval for Free/iad1, production-only connection, restore policy |
| Screenshots | Private object store; Vercel private Blob is a candidate for phase 99 | Private mode, supported upload adapter, retention, pricing and backup |
| Identity | GitHub App authorization, selected repositories only | App owner, exact callback origin, installation scope and permissions |
| Secrets | Vercel server-side environment configuration | Approved names/resources, production-only scope, rotation and revocation |

Vercel functions cannot keep durable state on their local filesystem. Use
bounded GitHub API reads and external storage, not a persistent checkout or disk.
[Function runtimes](https://vercel.com/docs/functions/runtimes).
New Postgres resources are provisioned through Marketplace providers, not the
retired Vercel Postgres product.
[Marketplace storage](https://vercel.com/docs/marketplace-storage).

### Price worksheet (checked 21 October 2026)

- Private GitHub repositories are included in GitHub Free; no incremental
  repository charge. [GitHub pricing](https://github.com/pricing).
- Vercel Hobby is $0 for eligible personal, non-commercial use. Pro starts at
  $20/month plus usage. The owner selected an existing Pro team; no subscription upgrade, new seat
  or paid add-on was created. Future deployment usage is billed on that team. [Pricing](https://vercel.com/pricing),
  [Hobby eligibility](https://vercel.com/docs/plans/hobby).
- Supabase Marketplace lists `free` at $0/month. Free includes a 500 MB
  database and pauses after one week of inactivity; use it for the initial trial.
  Paid upgrades and an independent backup destination remain owner decisions.
  [Supabase pricing](https://supabase.com/pricing).
- Private Blob incurs storage/operations/transfer usage against plan allowances;
  function delivery can incur additional transfer charges. Quote the selected
  account's allowances and overage settings before creation.
  [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).

No total operating price is approved yet. Prefer existing resources and explicit
limits; paid resources, overages and backups need a concrete owner decision.

### Connection recipe

1. Run `vercel login` locally, then inspect `vercel whoami` and `vercel teams ls`.
   Select the exact account/team; never paste tokens into the conversation.
   If login succeeds interactively but the agent reports logged out, compare
   config locations. Use the documented `vercel whoami --global-config <saved-config-dir>`
   command with the existing login; do not print or copy credentials.
2. Bind the private repository's numeric ID and workspace manifest privately.
   Start with an empty project list until the owner selects project access.
   Re-read privacy through the GitHub API; local manifest validation is not proof.
3. Choose database/API adapter and backup destination. Verify atomic single-use
   authorization, versioned drafts, unique intents and cross-instance leases.
   The current proposal uses Supabase PostgREST HTTP and narrow SQL functions
   for atomic state transitions. Deny anonymous and client-authenticated access
   to all runtime tables/functions; only the authorized backend may use them.
   [HTTP API](https://supabase.com/docs/guides/api/sql-to-rest),
   [database functions](https://supabase.com/docs/guides/database/functions).
   Native fetch needs a documented provider API; do not reverse-engineer an SDK
   endpoint to preserve zero dependencies. An SDK-only choice requires an explicit
   repository dependency exception before implementation. Defer media provisioning
   until its adapter and price are selected; phase 95 does not need screenshots.
4. Create the approved Vercel project from public application source with Node
   24.x, no framework/build requirement and an assigned HTTPS origin. Check the
   actual runtime patch before treating it as compatible. Entry points and the
   authenticated service ship in phase 95; a placeholder is not working login.
5. Register/install the approved GitHub App. Initial permissions: Metadata read
   and Contents read, selected workspace/project repositories only. Add Issues
   and Pull requests read when adapters need them; approve writes separately when
   decision/walk operations ship. No Actions or administration access is needed.
6. Configure the exact HTTPS callback and server-only App private key, client
   secret, session secret and database credential. Webhook signing secret is
   needed only when that route ships. Preview deployments use synthetic resources
   and separate credentials; untrusted branches must not receive production data.
7. Record provider IDs, permission matrix, secret names (never values), price,
   region, origin, serving revision and backup destination privately. Public
   evidence records only sanitized coverage. Phase 94 remains partial until real
   bindings are checked; phase 95 proves actual login and access denial.

Private Blob reads require authentication and can use a server-side bearer
request, then an authorized app route. The browser never receives a storage
token; responses must use private caching. The documented upload path uses the
SDK or CLI, so the zero-dependency upload adapter is still a phase 99 design
choice. Do not claim native-fetch uploads are already supported.
[Private Blob](https://vercel.com/docs/vercel-blob/private-storage).

## Acceptance worksheet for later phases

1. Sign in at the approved HTTPS origin; inspect only authorized projects.
2. Attempt a removed/unauthorized project and media deep link; see no private data.
3. On Home find the next decision, the next ready walk and a recently added feature.
4. Record a real decision; locate its source revision and operation receipt.
5. Start a walk, record a failed or blocked observation, reload and resume.
   Confirm acceptance stayed open. Test the current result successfully and
   explicitly submit; inspect only the intended acceptance change.
6. Open a real screenshot's provenance and follow Try it to the matching surface.
7. Revoke access and verify denial; logout and check session invalidation.
8. Restore Git records, database state and private media into an isolated approved target. Confirm sessions are expired,
   unresolved operations are reconciled before replay, and private artifacts and
   source records retain coverage. Record the actual observation window.

These are future checks. Retain expected and observed results separately. A
login callback, merged change or empty error window alone is not acceptance.
