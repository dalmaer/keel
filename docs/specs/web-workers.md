# Durable web workers

Phase [104](../phases/104-web-operations-run-through-durable-workers.md) implements
bounded operations behind the [fleet operating contract](web-fleet-operations.md).
This contract selects the initial adapter; it does not activate a runner, grant
GitHub permissions or approve spend.

## First supported operation

Start with the existing contributor `typecheck` workflow and its existing
`npm ci --ignore-scripts` / `npm run typecheck` commands. Add an optional web
request input and a separately gated worker path. Ordinary push, pull-request
and manual CI retain their current behavior and permissions. The web path runs
only after claiming an exact authorized operation. No arbitrary shell text,
provider credential, workspace secret bundle or model invocation is accepted.
The registry can describe another workflow only when it implements and has
verified the same worker protocol. Unsupported routines stay inspectable.

A private registry under `workers/<project-id>.json` names numeric repository
identity, workflow ID/path, branch, adapter/protocol version, trusted worker
source, timeout, concurrency and weekly minute ceiling. It is nonsecret owner
policy; policy and deployment activation must both allow the operation. There
is no inferred budget. The public app may ship an example, never actual private
registrations. Initial policy setup is an explicit operator step; the web cannot
silently enlarge that envelope.

The typed registry distinguishes start, cancel, retry, reconcile and schedule
change. Every operation defines accepted inputs, authority, exact preview,
provider effects, receipt schema and recovery. No generic command endpoint.
Registry source, approved project revision and workflow bytes are captured by a
preview digest. A changed source, identity, grant or policy requires new review.

## Trust and activation

All job effects default off. Enabling requires approved App Actions-write,
selected project/workflow registry, hosted migration 009 proof, exact worker
source and an approved runtime budget. Schedule source changes additionally
require current Contents/Workflows-write and their separate source-write gate.
No pending read-only history approval implies permission to dispatch.

GitHub documents dispatch inputs and an optional returned run ID, but no
idempotency key. A lost response remains uncertain. Cancellation is an accepted
request, not proof of termination. See the dated API references below.

A fixed operator-configured HTTPS Keel origin is the only worker callback
address. It is not a workflow input or a URL taken from project content. The
worker obtains a short-lived GitHub Actions OIDC token for that exact audience.
The server verifies its signature against the fixed GitHub issuer/JWKS, bounded
fetch and key cache, allowed algorithm, issuer, audience, time bounds and required
claims. A decoded token alone is no authority; unknown keys or unavailable
verification fail closed.

Bind a claim to numeric repository and owner, the expected dispatch actor ID,
workflow path/ref and SHA, project commit, event, run ID and job identity. Require
run attempt 1; a native rerun cannot use an earlier unclaimed operation. Use current provider run/job
readback where a claim alone cannot establish the expected job. Require the
approved operation identity in the provider run title and the exact expected
source. The title is only a lookup hint, never authentication. Pin a returned
run ID before accepting a claim for another candidate. A branch advancing after preview or dispatch is not permission to run
its new code. Retries outside the web cannot reuse an old grant.

The server also revalidates the initiating owner's still-live session, current
workspace membership, selected project access and registry before dispatch, worker claim and bounded heartbeats. Retain only its opaque server-side session reference in the private
job store; encrypted session contents remain in the existing auth store. Expired
or revoked access prevents a queued worker starting. A later authorized owner
may inspect/reconcile/cancel using their own fresh access. No bearer token is
returned in a job receipt or given to repository code.

The initial worker has only its repository's read-only checkout token and its
own OIDC identity. It cannot fetch phase 103 provider credentials. Provider-key
injection requires a later explicitly approved adapter; reserving this extension
point is not an implementation claim.

## Durable intent and budget

Optional migration 009 supplies service-role-only job records, reservations and
fences, with no client table access. It does not depend on the optional provider
vault. Scope includes the instance, workspace, numeric project and operation
identity. All external rows are validated by operation; absence, conflict and
malformation cannot be substituted for each other.

Before any provider effect, reserve the exact reviewed intent atomically:

- Browser-known request ID, actor and preview digest identify one submission.
  Duplicate or lost responses recover the same intent; a different body cannot
  reuse its identity.
- One active reservation per configured project/worker lane prevents competing
  operations. Weekly minute budget and lane acquisition share the transaction.
- Reserve the configured maximum runtime, including the supported workflow's
  setup allowance. Use a rolling seven-day window, measured in UTC, and explicit minutes.
  Cap workflow execution accordingly; a policy cannot claim a smaller ceiling
  than the installed worker can enforce.
- A reservation for unknown delivery or a nonterminal provider run remains held.
  Do not infer zero usage, release at lease expiry or refill on browser timeout.
  Charge completed work for seven days after its observed terminal timestamp,
  and keep older unresolved reservations charged. This conservative completion-
  based window avoids a calendar rollover freeing an unfinished job. The same
  transaction and workspace-wide allowance cover concurrent projects and retries;
  project limits may narrow it. Policy changes cannot erase existing charges.
  Retain actual observed usage separately from the conservative budget charge;
  unsupported financial costs stay unknown.

Persist the single dispatch transition before its POST. No other request or
reconciler may send that transition again. A server crash before the POST may
therefore leave an uncertain intent that did not run; preserving it is preferable
to duplicate effects. Report the uncertainty and recovery limits honestly.
An authoritative pre-dispatch refusal may release the unused reservation; a
transport failure or ambiguous response may not.

Use the returned run identity when valid, with independent run readback. A
bounded exact-title/source search or an authenticated worker claim can recover
a lost identity. Do not pick the newest similar run. Multiple matches are a
conflict; incomplete scans are unavailable. Numeric repository identity must
remain the same even if a name moves. Bind one provider run/attempt to the intent.

## Worker lifetime

A verified worker claim atomically allocates a fence and records run, attempt,
job and deadline. Verify the actual checkout SHA as well as the workflow SHA
before executing; isolate OIDC permission from ordinary pull-request jobs. Only that owner may heartbeat or complete the claim. Duplicate
claim requests must not start a second process. An expired lease reports worker
loss; it does not authorize takeover while the provider run might still act.
A completion from an older fence cannot change the outcome.

The worker retains a random claim nonce for its one process. A lost claim response
may recover the same run/attempt/job/nonce and original fence/deadline; it cannot
renew the lease or allocate a new claimant. A different nonce is refused. Before
spawning, a separate atomic begin transition grants execution once. An uncertain
begin response does not permit execution or another begin: stop and reconcile.
Heartbeat/completion sequence checks cannot revive a terminal state. Restoring
the database requires reconciling prior outstanding intents before effects are
re-enabled; an empty restored table is not evidence of unused budget.

The workflow performs no project command before a valid claim and confirmed begin. A small Node
bridge executes only the named adapter's fixed commands, observes its deadline,
heartbeats, and stops its child process on lost authority, cancellation or lease
failure. Bound each provider call and child lifetime, including the stuck case.
Report start/finish with safe structured status; retain logs at their existing
provider destination. No raw transcript upload or second scheduler.

Provider state and worker result remain separate. A successful process is not
project acceptance. Provider terminal evidence is required before considering a
run stopped or making a competing retry eligible. Unknown completion cannot be
converted to success by lease expiry. Preserve unresolved receipts for operator
reconciliation without redispatch.

## Cancel, retry and schedules

Cancellation before dispatch can retire only a provably unsent intent. During
uncertain dispatch, hold the reservation and reconcile its identity; a later
worker claim observes the cancellation and refuses to begin. Cancellation before
claim or during execution retains that request until provider terminal proof.

Cancel targets an exact observed run/attempt under fresh access. Record intent
before calling GitHub; retain requested/uncertain state until source readback
confirms a terminal result. No force-cancel fallback is implicit. A lost cancel
response is inspected against the same run, never interpreted as a new start.

Retry is a fresh linked operation and preview after the preceding provider run
is confirmed terminal. It reserves its own budget and captures the current
source and access again. Do not call an unrestricted native rerun that bypasses
the worker's original request/fence. A newer source must be visible in review.

The schedule editor is deliberately narrow: an existing single literal UTC cron
on a project-owned simple typecheck workflow, with a known literal job timeout,
constant noncancelling concurrency and explicit schedule budget policy. Match the
reviewed canonical fixed-command source shape, normalizing only the cron value.
Reject a path owned by `.keel/lock.json`: editing a managed night workflow would
create drift that render overwrites. A separate schedule-only registration may
expose this editor without claiming OIDC dispatch support; it has no start button.
The private policy bounds allowed cadence and scheduled minutes separately from
web jobs. Source edits outside the cron invalidate this capability. Preserve every other byte. Show current/proposed cron, UTC,
existing concurrency/overlap behavior, workflow/project identity, exact file,
source revision and budget before approval. Refuse expressions, aliases, ambiguous
YAML, multiple schedules, unknown overlap, or a proposed schedule exceeding the
approved cadence/budget envelope. This editor does not make an existing cron
execution subject to web reservations: it must show the workflow’s existing
budget mechanism separately. Without verified source budget/overlap semantics,
the edit remains unavailable. A changed schedule is a conditional source
commit with the existing durable receipt/recovery semantics, not a direct file
rewrite. This does not add cron to the first typecheck workflow, which currently
has none. No schedule or budget is enabled as part of this source implementation.

## Web experience

Routine details show the selected worker, source/ref, activation status and exact
reason controls are unavailable. Start/retry previews state the work and reserved
minutes. After submission, retain a bookmarkable receipt before the network
request; refresh or a second device can inspect that same operation. Do not
silently resubmit on reload. Show queue, claim, running, cancellation requested,
provider terminal and unresolved states with their actual source timestamps.

Link the external run and existing routine attempt detail. Keep parent/retry
relationships and private operation receipts together without counting the same
run twice. Separate reserved minutes, observed duration and unknown cost. Project
views enforce current project scope; fleet views are the authorized union.
Views render on desktop/mobile and expose pending operations without requiring an
open browser session.

## Proof and real-surface boundary

Named tests remain `tests/web-jobs.test.mjs` and
`tests/web-routine-actions.test.mjs`. Supporting tests exercise actual OIDC,
worker bridge, SQL and authenticated routes. Prove duplicate reservation/dispatch, lost claim and begin responses,
provider response loss, stale ref, source/permission change, forged/replayed
identity, worker loss, fence rejection, denied cross-project access, bounded
child execution with live descendants, cancellation races, week/window rollover,
linked retry and exact schedule
preservation/refusal. Use actual subprocess behavior for the worker, and isolated
PostgreSQL role/concurrency assertions for the store. Hosted proof needs two
independent database connections; one in-process connection is not that proof. Synthetic Acme fixtures
must not claim real GitHub or hosted database proof.

The conductor independently walks the actual local browser at desktop/mobile
sizes and retains screenshots of previews, running/uncertain receipts and
recovery. The owner's real workflow-shell exercise remains open until approved
activation: one bounded typecheck dispatch, duplicate request/reconnect,
cancellation and a separately reviewed retry, plus an approved existing schedule
edit preserving unrelated bytes. The first typecheck adapter cannot establish
that schedule surface because it has no cron. Record serving/worker revisions,
provider run/attempt IDs, actual observations, budget and gaps. Do not start that
exercise without the explicit permission and runtime allowance.

## Implementation decisions

- **2026-10-21** — Managed night files are not a direct schedule-edit surface.
  Source inspection showed render owns them. The initial schedule adapter is
  restricted to project-owned simple typecheck sources with an existing cron;
  this repository’s no-cron typecheck cannot establish the real schedule walk.
- **2026-10-21** — The initial web worker reserves a fixed fifteen-minute job
  ceiling, including setup. The provider-observed job start anchors its deadline;
  the claim cannot start a fresh allowance.

## Dated provider references

Read 2026-10-21 UTC:

- [Workflow dispatch API](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28): Actions-write, branch/tag ref, configured inputs and `return_run_details` response identity.
- [Workflow run API](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28): scoped run/attempt reads and cancellation request semantics.
- [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc): issuer/audience, timing and repository/workflow/run/job claims.

The fencing, recovery and budget design above is Keel's interpretation and
additional protocol, not a guarantee supplied by a dispatch endpoint. Live
compatibility still requires the named exercise.
