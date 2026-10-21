# Set up a private Keel web workspace

Design/setup worksheet, 21 October 2026. Phase 93 provides local manifest and
state initialization. Hosted login and Home are subsequent phases, not commands
you can run today. See [the contract](../specs/web-workspace.md).

## Prepare the data boundary

Keep three separate locations, for example (illustrative Acme paths):

- `/srv/keel/app`: installed public application, read-only in deployment.
- `/srv/keel/workspace/workspace.json`: manifest in a private repository checkout.
- `/srv/keel/state`: private persistent runtime directory, outside any Git tree.

The paths are explicit; the runtime directory's parent must exist. Do not put
credentials in the manifest. Create the version 1 manifest from the contract,
then, once phase 93 is built:

```sh
keel workspace inspect --manifest /srv/keel/workspace/workspace.json --state /srv/keel/state --json
keel workspace init --manifest /srv/keel/workspace/workspace.json --state /srv/keel/state --json
keel workspace init --manifest /srv/keel/workspace/workspace.json --state /srv/keel/state --yes --json
```

Preview exits 3 and writes nothing. Explicit initialization is idempotent for
the same identity. Remote privacy remains unverified until checked through
GitHub. This does not create a repository, host a service or authenticate anyone.

## Select and approve the first instance (phase 94)

| Choice | Required information | Resource action |
| --- | --- | --- |
| Workspace repo | Account/name; reuse or create; verify `private` and numeric repo ID | Creating a repo needs the owner's yes |
| Host | Existing host/account or new provider; Node >=24.21, HTTPS, secret injection, private persistent volume, backups | Quote the actual plan/storage/backup price before provisioning |
| Origin | Approved HTTPS URL/domain and exact callback URL | Domain purchase/DNS changes need the owner's selected destination |
| GitHub App | App owner, selected project repos, private workspace repo | Register/install only after approval of exact permissions |
| Runtime storage | Private absolute path, capacity, backup destination | Verify outside Git and application paths; no public bucket |

No provider or price has been selected. Phase 94 first fills this worksheet with
a concrete provider-specific recipe and current pricing, then requests approval.
The choice can reuse existing resources; do not imply they are free or available.

Initial GitHub App permission proposal: repository Metadata read and Contents
read, selected repositories only. User authorization provides the user-access
intersection. Webhook subscription is optional for the first bounded polling
reader. Add Issues/Pull requests read only when their adapters ship; add source
write permissions separately with the decision/walk operation. No administration,
Actions execution, workflow-write or organization-wide installation requirement.

Secrets to inject, never commit: App private key/client secret and server session
secret; webhook signing secret only when that route exists. Store stable
provider IDs and the allowlisted owner identity privately. Return public setup
evidence as sanitized state/coverage, never tokens, private names or membership.

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
8. Restore a backup into an isolated approved target. Confirm sessions are expired,
   unresolved operations are reconciled before replay, and private artifacts and
   source records retain coverage. Record the actual observation window.

These are future checks. Retain expected and observed results separately. A
login callback, merged change or empty error window alone is not acceptance.
