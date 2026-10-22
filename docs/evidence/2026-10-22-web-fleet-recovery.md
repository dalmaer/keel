# Evidence: phase 108 — fleet recovery preserves original effects

- Date: 22 October 2026 UTC.
- Phase: [108](../phases/108-the-fleet-is-operated-from-the-web.md).
- Revision: `f57759a38ff6d1a9082db580b566c3d230569fbf` plus the working tree
  committed as `phase 108: The fleet is operated from the web`.
- Claim checked: local restore/reconnect matrix and feature admission prevent
  blind replay and reuse of pre-restore execution assertions. This is not a
  hosted fleet trial, complete backup proof or owner acceptance.
- Decision context: `not-configured`, no accepted choices/proposals/gaps;
  digest `42ae6744caf2afb566e9adb0cd0e124a6b2fa30a519acd1402850e59d50dda0f`.
  Claim ownership was rechecked mine/here before dispatch/resume. This legacy
  context does not establish verified architecture coverage.

## Automated checks

Conductor executed, exit **0**, **123/123**:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-fleet-recovery.test.mjs tests/web-restore.test.mjs tests/web-jobs.test.mjs tests/web-fleet-updates.test.mjs tests/web-model-routing.test.mjs tests/web-model-handoff.test.mjs tests/web-night-plan.test.mjs tests/web-night-retry.test.mjs
```

The new matrix contributes **16 tests**. It serializes actual persisted fixture
records into independent service/store fixtures, retaining synthetic provider
history separately. No new parallel implementation of the domain state machines
was introduced. It verifies:

- Original uncertain routine identity and retained minutes after elapsed time;
  old initiating session exists but fails its epoch check, and worker lease loss
  does not refund or mutate the saved job.
- Lost update ref/PR readback inspects only the original effect, preserves an
  unresolved partial rollout and never implicitly continues the next stage.
- No-ID model uncertainty retains its ceiling without another create. A known
  response can be reconciled with model execution disabled; terminal usage and
  calculated cost remain separate from project acceptance.
- Native retry uncertainty retains its shared minute charge and project lane,
  even after elapsed time and a later unverified provider attempt.
- Global quarantine blocks each family before business effects; current scope,
  permanent auth epoch, stale feature assertions and independently disabled
  settings are enforced. Fresh assertions do not grant permissions or enablement.
- Exact existing job cancellation retains its previous activation requirements
  and one-send rule. Model cancellation retains the original response identity
  and one cancel grant without enabling a new task.

The conductor read the test claims and ran them independently. The original
worker-auth assertion was strengthened to establish that the exact old session
was present and unexpired before expecting epoch denial; lease loss is checked
separately. A failure from an unrelated missing key cannot prove this boundary.

The retained [actual SQL fleet restore proof](2026-10-22-fleet-restore-sql-proof.mjs)
also exited **0**, using separately installed **PGlite 0.5.11**:

```sh
# Set KEEL_SQL_PROOF_MODULE to the absolute separately installed PGlite module.
node docs/evidence/2026-10-22-fleet-restore-sql-proof.mjs
```

It applies SQL001/008/009/010/011/013, uses their bounded RPCs, copies a logical
snapshot into a second fresh database, and checks exact durable field equality.
Browser roles remain denied. Advancing record ages eight days and expiring a job
lease retains the synthetic **75-minute shared charge**, its lanes and unknown
model ceiling/pool reservation. Repeated send grants refuse; publication state,
stage and CAS survive without implicit advancement. The original backup remains
unchanged. The first script assertion expected a false grant where SQL returned
the stronger state-conflict refusal; the assertion was corrected to require that
exact conflict. No runtime change was made for that test-authoring mismatch.

SQL payloads in this script are opaque synthetic placeholders. It does not test
encryption or real provider calls. There is one connection per database: hosted
concurrency, object storage, missing post-snapshot operations and actual backup
completeness are unverified. Phase101 separately proves real ciphertext survival
and HTTP/auth quarantine with actual SQL001/004.

## Findings and corrections

Before implementation, the new stale-assertion test failed: reopening admitted
worker execution using a restore assertion older than the current restore.
Existing per-feature assertions now require a canonical past instant at or after
`recovery.startedAt`, alongside completed global reconciliation. No recovery
object preserves the existing admission behavior.

The matrix also reproduced known-response readback being blocked by model
execution disablement. Original-ID observation/cancellation is now separate
from admitting new model execution. Review caught a P1 in the initial correction:
removing the combined gate also removed global Connections disablement. The
reviewer reproduced a cancellation POST after that global disablement. The final
guard retains global connection enablement and wrapping-key availability, plus
current scope, descriptor enablement, policy/generation and exact response checks.
The new negative regression proves no credential read or provider request on
that refusal. Independent review reran **16/16**, exit **0**, and confirmed its
original reproduction now refuses with zero additional provider calls. No review
finding remains unresolved.

The full final-tree gate runs through `keel integrate`: `npm run check` (tests,
roadmap, render and inbox guards). `keel ready --check 'npm run typecheck'`
checks the selected production JSDoc scope first. Their results belong in the
integration receipt/subsequent record; no result is anticipated here.

## Real surfaces and decision

**Partial, owes owner walk.** No new interface layout was introduced; the
[visual tour](../guide/web-tour.md) retains the existing desktop/mobile captures.
The [private fleet worksheet](../guide/web-fleet-trial.md) now names every real
operating journey, failure case, source/receipt link, terminal detour and cost
coverage field. None is filled with an expected result presented as an observation.

The owner still selects the real fleet, participants, devices, private evidence
and backup destinations, and observation window. Hosted activation, actual
provider operations, physical-device input, source/media completeness and
repeated usefulness have not been checked here. No migrations, feature
activation, model/worker spending, deployment or live restore was performed.

Old writers must be stopped/drained and external workers accounted for before
restored state is connected. Retain the fresh permanent epoch, invalidate old
previews while preserving original intents, audit post-snapshot effects and
unknown charges, then record global/per-feature assertions. These operator
statements do not perform the audit or prove its completeness. Never count a
missing row as unused budget, a recovered PR as an install, or a model response
as human acceptance. A terminal workaround is recorded as an operating gap.
