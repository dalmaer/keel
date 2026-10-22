# Verify a deployment and restore a workspace

Use this guide with the [setup guide](web-workspace-setup.md) and
[restore contract](../specs/web-restore.md). Implementation checks are separate
from a real backup drill and repeated owner use. None of these steps authorizes
a new backup service, restore target, provider run or deployment.

## Check what is serving

After signing in, open `/api/deployment`. It returns the application's bound
revision (or unavailable), actual Node version, CLI version, observation time
and recovery state. This endpoint uses fresh workspace and repository access
checks and private no-store responses. Never use a public health endpoint to
test access to private project records.

Compare the revision with the exact deployment currently receiving production
traffic in Vercel. Record both observations privately. An environment variable
or a successful build alone does not prove which deployment served the request.
For a release, separately check the runtime against the current supported Node
minimum and retain the serving deployment ID, revision and observation time.

Verify revocation using an existing signed-in session: remove the relevant
authorized membership or selected repository through the approved owner flow,
then request the health observation and affected project again. Record the
actual denial. Restore access only through the owner's intended configuration.

## Prepare the private backup inventory

Choose the private destination, restore target, projects, participants and trial
window before starting. Keep the original backup untouched. Inventory each
source independently:

| Source | What the private record must identify |
| --- | --- |
| Private workspace Git | Exact commit, manifest, membership, shared lessons and policy files |
| Each project Git | Source revision, decisions, phases, evidence and referenced records |
| Runtime database | Snapshot time, schemas, encrypted sessions/drafts/intents/receipts and reservations |
| Private object storage | Object inventory, sizes/checksums, access metadata and missing objects |
| Wrapping keys and configuration | Separate protected recovery location, key versions and application configuration |
| External execution and source writes | Provider run/commit IDs, post-snapshot activity, unknown outcomes and charges |

Git history does not back up the runtime database or screenshot bytes. A database
backup does not back up encryption keys or external execution history. Keep
secrets, real screenshots and private inventories out of the public Keel repo.
Do not record credentials in the trial worksheet.

## Quarantine before connecting restored state

1. Stop admission to the old deployment and drain its writers. Inspect and stop
   or account for external workers separately. A web switch cannot stop a
   workflow or model request already running elsewhere.
2. Restore into the approved isolated target while ingress stays closed. Keep
   the same keys required to decrypt durable private records.
3. Generate a new nonsecret recovery epoch outside the restored database. Add
   this object to the instance JSON in deployment configuration:

   ```json
   {
     "recovery": {
       "epoch": "<new 32-character lowercase hexadecimal value>",
       "startedAt": "<actual UTC start, for example 2026-10-22T04:00:00.000Z>",
       "reconciledAt": null
     }
   }
   ```

   Replace both placeholders; the example is deliberately not ready to deploy.
   Timestamps must be canonical UTC instants in the past. Never reuse or remove
   the epoch after activating it. Existing instances that have never been
   restored may omit this object; the app cannot detect an omitted procedure.
4. Start only the quarantined deployment. Fresh login, `/recovery`,
   `/api/deployment`, `/api/session` and sign-out remain available. Old sessions
   and unfinished old login attempts must fail. Business routes, including
   receipt recovery GETs and worker callbacks, must refuse before acting.

Quarantine preserves pending operation state. It does not automatically replay,
expire, commit or refuse historical work, release charges, or establish that
backup coverage is complete. Keep worker, model and night execution disabled
throughout the audit.

## Reconcile the original work

Use protected operator inspection, outside normal quarantined business routes.
For each saved intent, inspect its original repository identity, revision,
provider request and receipt. A matching immutable commit proves that commit;
it does not accept a phase or prove a human test passed. Missing or incomplete
provider history remains unknown. Never send another request just to resolve
an uncertain result.

A snapshot may show `prepared` even though the request ran after the snapshot.
It may omit an operation entirely. Snapshot status and elapsed leases cannot
settle either case. Retain unresolved reservations and accounting evidence;
an empty restored table is not unused budget.

Perform reviewed maintenance to discard restored sessions/attempts and
invalidate old previews while preserving operation receipts and the metadata
they reference. Record every maintenance query and result privately. Reconcile
source records, database records, private artifacts and their coverage gaps
separately. Do not delete the original snapshot to make the restored state look
consistent.

Only after the operator records the audit may deployment configuration set
`reconciledAt` to the actual completion time, retaining the same epoch and
`startedAt`. This is an operator assertion, not automatic verification. Keep
individual execution features disabled until their own fresh restore proofs
and approvals hold. The initial workspace drill does not establish the expanded
fleet worker/routing recovery matrix in phase 108.

## Private owner trial worksheet

Copy these blank fields into the chosen private evidence location. Record
observations as they happen; expected results are separate. A terminal detour,
failed test, unavailable source or unknown cost is useful evidence.

| Field | Observation |
| --- | --- |
| Participants and authorized projects | |
| Start/end of agreed observation window | |
| Deployment ID, bound revision and independently observed serving revision | |
| Browser, physical device and viewport | |
| Backup destinations, snapshot times and protected key references | |
| Restored source/database/media coverage and explicit gaps | |
| Old writer/external worker disposition | |
| Recovery epoch/start and operator audit record reference | |
| Existing session and pending login denial | |
| Fresh login, health and fresh revocation observations | |
| Decision reviewed, original intent and observed receipt | |
| Guided test that worked: steps, revision and observed result | |
| Guided test that failed/could not be tested: details and follow-up | |
| Recent addition: screenshot provenance and matching preview inspected | |
| Uncertain operations: original request, source evidence and unresolved gaps | |
| Reopening assertion and each feature's separate restore proof | |
| Mobile and desktop repetitions across the chosen projects | |
| Terminal detours, time spent, known charges and unknown cost coverage | |
| Remaining work, owner decision and next observation | |

Keep implemented, deployed, production-verified and lived-in results separate.
Public evidence may link to sanitized synthetic captures; it must not contain
private source details, secrets or a claim that this blank worksheet was walked.
