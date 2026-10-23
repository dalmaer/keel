# Run supported routines from the web

A routine can be inspected before it can be run. The hosted control surface only
starts an explicitly registered worker whose current project, source, permissions
and budget have been approved. Reading a routine or opening a receipt starts
nothing. Execution remains disabled by default.

## Review an exact run

Open the project's supported routine and review the selected workflow, branch,
project revision, worker source and fixed work. The initial adapter runs the
existing contributor typecheck commands. It accepts no arbitrary shell command,
environment-variable editor or provider credential.

The preview shows the maximum reserved minutes and the current project and
workspace budget. Reservation is not a bill or measured duration. Missing actual
cost remains unknown. Review the exact source-bound digest before starting; a
changed branch, workflow, registration, permission or budget requires fresh review.

Before submission, the browser has an original request identity and a bookmarkable
receipt. Keep that receipt when the browser disconnects. Reloading it does not
repeat dispatch. A missing or uncertain provider response is not permission to
start another operation. Reconcile the original receipt to look for exact provider
identity; ambiguous or incomplete evidence remains unresolved.

## Inspect progress and request cancellation

The receipt separates provider state from the worker's reported result. Follow its
provider run and attempt links for the original logs. A successful process is not
project acceptance, a merge or production verification.

Cancellation is a request until provider terminal evidence confirms the run has
stopped. An uncertain dispatch keeps its budget reservation and cancellation
intent. Worker loss or a missed heartbeat cannot release a potentially running
job or authorize a competing worker. Old callbacks cannot replace a newer fenced
state.

A retry is a separately reviewed, linked operation after the preceding provider
run is confirmed terminal. It captures current source and reserves its own budget;
it does not use an unrestricted native rerun. Older unresolved reservations remain
charged. Completed work remains charged for seven days after its observed terminal
time. This adapter reports conservative reservations; measured duration and
financial cost are unavailable in its job receipt. The original provider attempt
remains linked for inspection.

## Keep the initiating authority current

Starting work requires a live initiating owner session, current workspace
membership and project access. The worker authenticates separately through
verified GitHub Actions OIDC; a browser cookie is not a worker identity. Claims,
bounded heartbeats and fixed-command execution remain tied to the approved run,
attempt, job, source and deadline.

The worker cannot prolong an expired owner session or obtain its GitHub token.
A newly authenticated owner may inspect, reconcile or cancel an earlier operation
without reviving its initiating session. No phase 103 provider-key injection is
implemented by this adapter.

## Change an existing schedule cautiously

Schedule editing only supports an approved existing single literal UTC cron with
known source budget and concurrency behavior. The preview shows the exact file
change, source revision, current and proposed cron, UTC, existing overlap policy
and its independent schedule budget. Every unrelated byte must be preserved.

Unsupported YAML, multiple schedules, expressions, unknown budget or overlap, and
cadence outside the approved envelope have no editable form. A cron commit does
not put ordinary scheduled runs under web reservations. The first typecheck
workflow has no cron; this feature does not add one or activate a schedule.

## Deployment and evidence

This guide describes the phase 104 source implementation. Synthetic fixtures and
local browser checks do not establish hosted activation or real workflow success.
All job effects require separate operator configuration and approved access,
private registry, migration 009 verification, trusted worker source and bounded
runtime allowance. Schedule writes have their own source-write gate.

Application code belongs in the public repository. Nonsecret registration and
budget policy belong in the private workspace repository. Durable jobs and
reservations belong in the external private store. The browser and serverless
request do not own the long-running process. The initial adapter uses existing
GitHub infrastructure; it installs no competing scheduler.

The optional service configuration is explicit. For example, this synthetic
shape keeps execution and schedule writes off while declaring a minute ceiling:

```json
{
  "jobs": {
    "enabled": false,
    "verifiedAt": null,
    "restoreReconciledAt": null,
    "weeklyMinutes": 15,
    "scheduleWrites": false
  }
}
```

Proof dates are operator assertions, not evidence by themselves. A restored
job store must reconcile outstanding operations before effects are enabled;
an empty restored table is not proof of unused budget. The fixed callback origin
comes from the approved `PLATES_WEB_ORIGIN` repository variable (with `KEEL_WEB_ORIGIN` as a
transition fallback), never a workflow
input. Private registrations pin numeric project/workflow identities and the
trusted workflow, bridge and runtime source bytes. Previously registered legacy
Keel workflow bytes remain accepted only as the exact reviewed legacy template;
all immutable source pins are still checked.

## Prepare a private worker registration

The initial dispatch adapter accepts the exact canonical contributor workflow in
Plates's [typecheck workflow](../../.github/workflows/typecheck.yml), together with
its [bridge](../../scripts/web-worker.mjs) and
[worker runtime](../../lib/web/job-worker.mjs). These are not installed by a
managed practice. Review and copy all three into the approved project at those
same paths, then commit them through that project's normal review process. The
project needs its own committed `.nvmrc`, npm lockfile and `typecheck` script.
The fixed work is `npm ci --ignore-scripts` followed by `npm run typecheck`;
registration cannot substitute another command. Copying the workflow also brings
its ordinary push and pull-request CI triggers, so review that separately before
publishing it.

The registration's branch must be the project's current default branch. Source
inspection does not select arbitrary branches. Pin the Git **blob** identities
from the approved committed checkout on that branch, not a file's SHA-256 or a
working-tree hash. These read-only commands identify the repository, owner,
workflow and committed source bytes for the synthetic `acme/studio` example:

```bash
gh api repos/acme/studio --jq '{repoId: .id, ownerId: .owner.id, defaultBranch: .default_branch}'
gh api repos/acme/studio/actions/workflows --jq '.workflows[] | {id, path, name}'
git rev-parse HEAD:.github/workflows/typecheck.yml
git rev-parse HEAD:scripts/web-worker.mjs
git rev-parse HEAD:lib/web/job-worker.mjs
```

Select the numeric workflow ID whose path is `.github/workflows/typecheck.yml`.
The provider must already recognize that committed workflow. In the **private
workspace repository**, create `workers/studio.json`, where `studio` is the
project ID in the workspace manifest. This complete synthetic example passes the
registration's structural contract but intentionally leaves it disabled. Its
numeric IDs and repeated-character blob values are illustrative; replace them
with the verified outputs above before review:

```json
{
  "version": 1,
  "projectId": "studio",
  "repoId": 102,
  "ownerId": 10,
  "enabled": false,
  "adapter": "typecheck-v1",
  "protocol": 1,
  "workflow": {
    "id": 501,
    "path": ".github/workflows/typecheck.yml",
    "branch": "main",
    "job": "web-worker",
    "workflowBlob": "1111111111111111111111111111111111111111",
    "bridgePath": "scripts/web-worker.mjs",
    "bridgeBlob": "2222222222222222222222222222222222222222",
    "runtimeBlob": "3333333333333333333333333333333333333333"
  },
  "timeoutMinutes": 15,
  "weeklyMinutes": 15,
  "concurrency": 1,
  "schedule": null
}
```

Each dispatch reserves the fixed 15-minute whole-job ceiling, including setup.
The project and workspace weekly ceilings both apply. The current workflow,
bridge and runtime must still match the reviewed pins when the owner starts or
retries. A new source version needs an updated registration and fresh preview.
Keep the service example above and this registration disabled while preparing
migration, restore and access evidence. Setting the approved HTTPS callback
repository variable, granting access, enabling execution and spending Actions
minutes remain separate owner-approved setup steps.

A separate schedule-only adapter can expose an existing project-owned typecheck
cron without enabling dispatch. Its supported source shape has a known timeout
and constant concurrency group that does not cancel in-progress runs. It preserves
unrelated bytes. Plates-managed workflow paths remain unavailable for direct editing
because their generator owns the source.

The real exercise separately verifies one approved bounded dispatch, reconnect
and duplicate request behavior, cancellation and reviewed retry. An approved
existing schedule exercise must also verify exact source preservation and its
actual budget/overlap semantics. Neither exercise is authorized merely by
installing this implementation.

See the [worker contract](../specs/web-workers.md),
[fleet operating contract](../specs/web-fleet-operations.md), and
[service setup guide](web-auth-service.md).

## Restore and reconnect trial

After a configured workspace restore, `jobs.restoreReconciledAt` must be a
canonical past instant at or after `recovery.startedAt`, and global quarantine
must have ended, before starts/retries/schedule writes can be enabled. Existing
permissions and allowance checks still apply. Original receipt inspection after
reopening stays separate from enabling execution.
See the [fleet trial worksheet](web-fleet-trial.md) for real device and recovery
observations, including terminal detours and unavailable costs.
