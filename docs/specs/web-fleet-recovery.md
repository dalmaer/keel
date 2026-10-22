# Restore and reconnect verification across plates

Phase108 binding design, 22 October 2026 UTC. This extends the
[workspace restore boundary](web-restore.md); it does not replace the owner's
real-use acceptance or authorize any provider work, resource or live restore.

## Preserve the original effects and accounting

Restore a serialized snapshot into fresh service/store instances. Provider state
is an independent source, not part of the snapshot. Preserve encrypted original
intents, external identities, pending requests, reservations, retained charges,
worker fences and update stage identities. Never turn an old lease, missing
receipt, absent callback or a browser reconnect into a new dispatch.

During the global quarantine, all these business routes remain blocked before
state changes or provider access. Old initiating sessions and worker authority
remain invalid after the fresh authentication epoch. An operator must audit
post-snapshot external work and unknown operations before reopening. The original
snapshot remains untouched; missing rows cannot establish unused budget.

After that explicit audit, inspection/reconciliation of the original identity
may read provider state. Incomplete history leaves an unresolved outcome and
retained charge. A matching terminal run, response or PR proves only that source
fact. It does not accept the project, install an update, verify production or
complete a human test. Recovery cannot silently continue the next update stage,
restart an agent or create a fallback model attempt.

## Fresh feature assertions after a restore

Global reopening is insufficient to enable execution using dates from before
the restore. Reuse the existing feature `restoreReconciledAt` fields; do not add
a second recovery store or change database schemas for this admission check.

When instance `recovery` is configured, an effect requires global
`reconciledAt` to be present and its applicable feature restore timestamp to be
a canonical past instant no earlier than `recovery.startedAt`. This allows an
operator to audit a feature during quarantine before recording global completion.
The dates are still operator assertions. They cannot prove a stopped worker,
complete backup or fresh provider access by themselves.

| Effect | Existing feature assertion |
| --- | --- |
| Worker start/retry and schedule writes | `jobs.restoreReconciledAt` |
| Update preparation and publication/continuation | `jobs.restoreReconciledAt` |
| Model run and checkpoint continuation | `modelRouting.restoreReconciledAt` |
| Native night retry | Both `jobs.restoreReconciledAt` and `nightOperations.restoreReconciledAt` |
| Night plan publication | `nightOperations.restoreReconciledAt` |

Retain all existing permission, enabled, source, budget and freshness checks.
The new test is independent of those gates: a fresh restore assertion does not
enable a feature whose owner disabled it. Instances with no recovery object keep
their existing behavior. Unknown or stale assertions refuse new effects. Pure
original-identity observation/reconciliation after global reopening must not
depend on enabling new execution; cancellation retains its exact-target current
authorization and durable one-send rules.

No timestamp authorizes reusing an unreviewed pre-restore preview. The operator
procedure still invalidates old previews and audits all retained intents before
reopening. A snapshot-time prepared record may have executed later. This phase
does not claim automatic detection of omitted operator maintenance.

## Named local matrix

`tests/web-fleet-recovery.test.mjs` must exercise actual service/domain adapters
with serialized state restored into independent fixtures. Synthetic transports
are acceptable for local proof only; state-machine stand-ins are not proof of
PostgreSQL concurrency. Include:

- Routine dispatch with lost delivery, missed callback or worker lease loss:
  original IDs, no second dispatch, unresolved charge retained, old initiating
  authority denied, current scope rechecked.
- Update publication with a lost ref/PR response: bounded original effect
  readback, no duplicate object/PR, no implicit continuation of later stages;
  missing history and partial rollout remain visible.
- Model attempt with unknown delivery or usage: no create on reconnect,
  no-ID uncertainty retains its ceiling; a known response ID can be inspected
  without another create, and terminal usage/cost stays distinct from acceptance.
- Native night retry with unresolved delivery: retain shared lane/minutes across
  the snapshot and elapsed time; observation cannot redispatch the retry.
- Global quarantine, revoked access and stale per-feature restore dates refuse
  before effects. Fresh dates do not bypass an independent disabled feature.

Record exact commands and failure assertions. Add only narrow helper seams
needed to serialize the real persisted fixture records, not a parallel behavior
implementation. If a required boundary fails, reproduce it and correct its
existing adapter rather than weakening the matrix. Actual SQL snapshot proof
is retained separately with its single/multiple connection limits stated.

## Real operating exercise

The owner selects projects, participants, private evidence destination and
observation window. On mobile and desktop: investigate a failed night and its
evidence, run an approved bounded retry, review a lesson, preview/update a canary,
inspect the resulting PR and separately observed version, inspect capacity and
explain a policy-approved fallback. Include revoked scope, expired credentials,
stale capacity, exhausted budget, duplicate clicks, partial rollout, worker loss,
offline reconnect and restore with unresolved jobs.

Record each attempt's source revisions, before/after observations, original
receipts, sanitized captures/preview links, terminal detours, elapsed time,
actual/estimated costs and unavailable coverage. No blank field means zero.
Unsupported capability is a gap, not successful completion through a terminal.
The public record contains sanitized summaries only; private project content,
credentials and real captures remain in their approved private stores.
