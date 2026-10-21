# Set up a private Keel web workspace

Setup guide, updated 21 October 2026. Phase 93 provides local manifest and state
initialization. The first private repository and Vercel project exist; hosted
sign-in and Home are not deployed. Supabase is provisioned for production and
the read-only GitHub App is approved but awaits identity verification. Phase 95
now provides the authentication service implementation; its
[service guide](web-auth-service.md) gives the exact configuration and migration. See [the contract](../specs/web-workspace.md) and
[phase 94](../phases/94-private-instance-has-approved-connections.md) for the
remaining connection work. This guide separates commands you can use now from
setup for the future service.

## Create or reuse a private data repository

You need Node >=24.21.0, Git, the Keel CLI and GitHub CLI. Authenticate with
`gh auth login`. Choose your own account/organization and repo name: the examples
use `acme/keel-data`. Never put your private workspace records in the public
application repo. Repository creation is an owner-approved resource action;
private repositories are included in GitHub Free, but other features and usage
have their own limits. [GitHub pricing](https://github.com/pricing).

For a new repository:

```sh
mkdir -p "$HOME/code"
gh repo create acme/keel-data --private --description "Private Keel workspace records" --add-readme
gh repo view acme/keel-data --json nameWithOwner,isPrivate,id
gh repo clone acme/keel-data "$HOME/code/keel-data"
```

For an existing repository, skip creation and reuse its checkout or clone it to
an unused destination. Read back `isPrivate: true` before adding private content;
a missing or inaccessible repo is not proof of privacy. Preserve existing files.
The checkout must be outside the installed Keel application tree. Store its
provider ID in private setup records, not in public application documentation.

Create `workspace.json` in the private checkout using this schema, substituting
your own account, identity and display name:

```json
{
  "version": 1,
  "id": "acme",
  "name": "Acme",
  "repo": "acme/keel-data",
  "projects": []
}
```

Use an empty project list until you have selected the projects to include. IDs
use lowercase letters, digits and hyphens, start with a letter and have a
64-character maximum. Repository values are `owner/name`, not URLs. Unknown
fields are rejected; do not add deployment settings or secrets to the manifest.
The full version 1 schema is in `keel --agent-help workspace`.

Add secret/runtime exclusions to your private repo's ignore file without replacing
its existing entries: `.env`, `.env.*`, `*.pem`, `*.key`, `.vercel/` and `runtime/`.
These are safeguards, not permission to store runtime state under Git; the CLI
rejects state inside any working tree even when ignored. After validation below,
review and commit only the intended records:

```sh
cd "$HOME/code/keel-data"
git diff -- .gitignore workspace.json
git status --short
git add .gitignore workspace.json
git diff --cached --check
git diff --cached -- .gitignore workspace.json
git commit -m "Configure private Keel workspace"
git push
```

`git diff` alone omits untracked files; read the new manifest and review the staged
diff before committing. Keep private setup IDs and shared lessons here; use the
provider secret store for credentials. This repository is separate from both the
public application checkout and the private runtime store.

## Add projects and retain their own records

Add a project to the manifest by replacing the empty array with entries such as:

```json
"projects": [{ "id": "studio", "repo": "acme/studio" }]
```

Project IDs and repository identities must be unique; the workspace repository
cannot also be a project. Re-run inspect after edits. Listing a repo grants no
access and changes no project files. For a project already using Keel, retain its
`.keel/keel.json`, planning source, decisions and evidence there. For a new or
existing project that needs adoption, follow [Start a project](start-a-project.md)
or [Bring a project under Keel](bring-a-project-under-keel.md).

The authentication service checks the intersection of workspace membership,
GitHub App installation and the signed-in user's repository access. Phase 95
implements that boundary; local manifest validation does not verify it.

### Shared lessons and the existing inbox

The private workspace can hold shared private lesson records, but this foundation
does not redirect the existing lesson workflow. `keel lessons` still uses the
configured inbox. A folder of shared lessons in a private data repo does not
change the visibility of any issue destination. Retain the current fleet and
inbox until an explicit migration has been previewed and verified; phase 100
owns that work. See [Lessons and learning](lessons-and-learning.md) and
[Keep the fleet current](keep-the-fleet-current.md).

## Prepare the local data boundary

The runtime directory is separate from the private checkout, never inside it.
For example, these illustrative server paths keep the three locations separate:

- `/srv/keel/app`: installed public application, read-only in deployment.
- `/srv/keel/workspace/workspace.json`: manifest in a private repository checkout.
- `/srv/keel/state`: private persistent runtime directory, outside any Git tree.

The paths are explicit; the runtime directory's parent must exist. Do not put
credentials in the manifest. Create the version 1 manifest from the contract,
then use the built phase 93 commands. Substitute your real absolute paths;
for a home directory layout, the README uses a checkout under `$HOME/code` and
state under `$HOME/.local/state`:

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
deployed. Supabase Free is provisioned in `iad1` and connected only to production;
its sensitive environment credentials are injected by Marketplace. The resource
also restricts future connections to production; initial credential rotation
completed before deployment. The owner approved the
read-only GitHub App; registration awaits GitHub identity verification. No App
or Blob store exists yet.
Exact account, project and domain identifiers live in the private workspace repo.
The earlier Render single-instance candidate was not approved or created and is
superseded by this choice. The local filesystem adapter above remains supported;
it is not the storage implementation for hosted requests.

| Layer | Binding or planned binding | Remaining decision/check |
| --- | --- | --- |
| Application | Public Keel source; framework-free Node functions and browser modules | Account/team and project verified; region and actual Node >=24.21.0 remain |
| Shared records | Owner-selected private GitHub repository | Numeric identity, manifest, members file and selected project list retained privately |
| Sessions/drafts/receipts | Supabase Postgres via Marketplace, Free/iad1 connected to production | Runtime schema, access denial proof, restore policy |
| Screenshots | Private object store; Vercel private Blob is a candidate for phase 99 | Private mode, supported upload adapter, retention, pricing and backup |
| Identity | GitHub App authorization, selected repositories only | Approved owner, callback and read-only scope; identity verification, registration and installation remain |
| Secrets | Vercel server-side environment configuration | Database credentials injected in production; App secrets, rotation and revocation remain |

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
  $20/month plus usage. The owner selected an existing Pro team; no subscription
  upgrade, new seat or paid add-on was created. Future deployment usage is billed
  on that team. [Pricing](https://vercel.com/pricing),
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
   command with the existing login; do not print or copy credentials. On macOS,
   the successful saved location in the first setup was:

   ```sh
   vercel whoami --global-config "$HOME/Library/Application Support/com.vercel.cli"
   vercel teams ls --global-config "$HOME/Library/Application Support/com.vercel.cli"
   ```

   Use that option only when it is your existing login directory; do not assume
   it exists on Linux or Windows. Keep the same option on subsequent commands.
   Once the owner chooses a team, scope every operation explicitly:

   ```sh
   vercel project ls --scope acme-team
   vercel project create keel-workspace --scope acme-team
   vercel project inspect keel-workspace --scope acme-team --json
   vercel api /v9/projects/keel-workspace/domains --scope acme-team
   ```

   Substitute the selected team and project. Skip creation if reusing an existing
   project. These commands create/read configuration; they do not deploy the app.
2. Bind the private repository's numeric ID and workspace manifest privately.
   Start with an empty project list until the owner selects project access.
   Re-read privacy through the GitHub API; local manifest validation is not proof.
3. Choose database/API adapter and backup destination. Verify atomic single-use
   authorization, versioned drafts, unique intents and cross-instance leases.
   The selected adapter design uses Supabase PostgREST HTTP and narrow SQL functions
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
6. Configure the exact HTTPS callback and server-only client secret, session
   encryption key and database credential. The initial user authorization flow
   does not use an App private key; do not generate one for this phase. Webhook signing secret is
   needed only when that route ships. The phase 95 entry point refuses non-production Vercel environments. Future
   preview authentication needs separate synthetic resources and credentials;
   untrusted branches must not receive production data.
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
8. Restore Git records, database state and private media into an isolated approved
   target. Confirm sessions are expired,
   unresolved operations are reconciled before replay, and private artifacts and
   source records retain coverage. Record the actual observation window.

These are future checks. Retain expected and observed results separately. A
login callback, merged change or empty error window alone is not acceptance.
