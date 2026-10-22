# Restore verification and serving identity

Phase101 binding design, 22 October 2026 UTC. The original Done when remains a
real-use outcome. Local checks support the owner trial; they cannot substitute
for a private backup, a serving deployment or a physical device observation.

## A restored database is not a current account of external work

A backup can precede a send, receipt or revocation. A restored prepared operation
may have executed after the snapshot. An empty table is not unused allowance.
Never resume business actions merely because restored records look ready or old
leases have expired. Reopening a normal receipt page can itself reconcile state;
a POST-only switch or disabled button is not a sufficient restore boundary.

Before attaching a restored database, stop/drain old writers and external workers
and keep ingress closed. Preserve the keys needed to inspect private encrypted
records. Configure a fresh nonsecret recovery epoch in deployment configuration,
which is outside the restored database; never reuse or later remove that epoch.
No automatic detection of a restore is claimed. Operator omission of this
procedure cannot be repaired by a timestamp inside the restored database.

Add optional instance `recovery` configuration with exact fields `epoch`,
`startedAt` and `reconciledAt`. Epoch is 32 lowercase hexadecimal characters,
generated uniquely for the restore. Timestamps are canonical past UTC instants;
`reconciledAt` is null until the operator has completed the recorded audit and
must otherwise be no earlier than `startedAt`. Existing non-restored instances
may omit the object. Retain it after reopening: clearing the quarantine does not
make old sessions valid again. These fields are operator assertions, not proof.

Bind authorization attempts, sessions and worker-initiator resolution to the
current epoch. Old or missing epochs refuse after epoch activation, including a
concurrent renewal or OAuth callback; no provider token exchange may occur from
an old authorization attempt. Keep the existing encryption keys so durable
private records remain readable. Do not rotate one shared key merely to expire
sessions and thereby strand operation/draft ciphertext.

While `reconciledAt` is null, quarantine all business routes, including GET routes
that may recover receipts, drafts, uploads, credentials, model work, jobs, retries
and worker callbacks. Authenticate fresh access to the recovery page and health
observation; permit authenticated `GET /api/session` with fresh access checks
and no query as the existing login observation. It must not touch pending
operations. Permit only existing static assets and authentication/logout/revoke
routes alongside those explicit observations. Do not initialize new external
work or alter pending operation state through a quarantined request. Unknown
business routes default to refusal. The browser explains that verification is
in progress without claiming unsaved content or acceptance was preserved.

Quarantine is an application admission boundary, not proof that an already
running external process has stopped. Verify old workers and deployment traffic
separately. Do not automatically disable provider workflows, delete records,
release charges or mark any operation refused/committed because a restore began.

## Reconcile before reopening

Keep the original backup untouched. Inventory source Git, database records,
private objects and their wrapping keys separately. Record snapshot times, known
gaps and unresolved identities. Discard restored authorization attempts/sessions
as maintenance, and invalidate old previews without deleting operation receipts
or their referenced metadata. Retain unresolved reservation/accounting evidence.

For each retained conditional write, use its original intent to inspect the
actual source. A matching immutable commit establishes that commit only, never
acceptance. A missing or incomplete source remains unresolved. In particular,
snapshot-time prepared/refused/terminal state cannot establish what happened
after the snapshot. No blind replay or automatic refusal from elapsed time.
Do not infer absence of operations that the backup may not contain.

Reopening is an explicit operator action after the private reconciliation record,
not a public browser button or an automatic test result. Retain the epoch and
record `reconciledAt`; reset individual worker/model/night restore-verification
bindings and keep those features disabled until their own current proof exists.
This initial phase proves the session/quarantine and conditional-write recovery
boundaries. The expanded fleet restore matrix and cost/worker observations belong
to phase108 and must remain separately unverified.

No backup destination, restore target, paid service, database migration or live
restoration is created by this implementation. The owner still chooses the
private backup destination, projects and real-use window.

## Identify what serves the request

Provide authenticated `GET /api/deployment`, with exact query validation, current
membership/repository authorization and private no-store responses. Report CLI
version, actual Node runtime, a validated serving revision from the deployment
binding (or unavailable), observation time and the operator-asserted recovery
state. Do not expose secrets, arbitrary environment variables or private backup
paths. Compare its claimed revision with the provider's actual serving deployment
before recording production verification; an environment value alone is not that
independent evidence. A revoked owner or project scope cannot keep reading health
through an old session.

The recovery page is usable on mobile and desktop and links to this authenticated
observation. Sign out stays available. Source and operation screens are withheld
during quarantine, so they cannot implicitly resolve historical state.

## Proof

`tests/web-deployment.test.mjs` exercises the actual HTTP service: authenticated
identity, missing/malformed revision, cache/secret boundary and fresh revocation.
`tests/web-restore.test.mjs` serializes and restores state into independent service
instances, changes epoch, refuses old login/callback/worker initiator state,
preserves private ciphertext, and blocks every business route family before
provider writes or operation changes. Include GET recovery and unknown routes.
After an explicitly completed audit, new sessions work while old sessions remain
invalid. Exercise original uncertain conditional intent reconciliation without a
second external write; preserve unknown outcome and acceptance separately.

Retain actual SQL proof separately where it establishes database behavior. One
connection does not establish hosted concurrency or backup completeness. The
owner worksheet records the approved deployment, actual revocation, failed and
successful guided tests, visual discovery, real restore, source/media coverage,
physical devices, terminal detours, duration and known/unknown costs. Never fill
an observation with an expected result.
