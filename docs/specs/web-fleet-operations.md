# Operate the fleet from the web

Design extension, 21 October 2026, following the owner's request to drive all
Keel projects from mobile and desktop. This expands G7 beyond the first decision
workspace; it does not claim that hosted execution or provider integrations exist.
The [workspace contract](web-workspace.md) owns privacy and authorization, the
[UI spec](web-ui.md) owns Home, and the [command inventory](web-ui-command-map.md)
owns the dated CLI mapping. This document owns fleet operations and phases 102–108.

## Outcome and scope

The owner can choose a project, understand everything Keel has done and is doing,
make decisions, test changes, manage routines and updates, learn across the fleet,
and manage execution capacity from the web. Desktop and mobile have the same
capabilities. The first Home release remains focused on decisions, guided tests
and visible changes; the full product cannot be considered complete at that point.

“All projects” means every project the workspace is authorized to manage, with
capability and coverage differences visible. “Every routine” means all recorded
attempts from connected sources within the declared retention window, including
CLI/workflow starts outside the web. Missing instrumentation, disconnected local
runners, expired artifacts and incomplete history are explicit gaps. A browser
cannot reconstruct runs that were never recorded.

## Two lenses on the same records

Use a persistent **Fleet / project** selector. Switching lens preserves the
current destination and applicable filters. Every project item carries its name,
repository identity and source timestamp. Fleet totals deduplicate shared jobs
and account-level capacity; narrowing to a project never implies that a shared
provider quota becomes that project's private allowance.

| Fleet destination | What the owner sees and does | Project lens |
| --- | --- | --- |
| Home | Decisions, ready tests, visual changes, project cards, active work, capacity alerts | Same hierarchy restricted to this project |
| Projects | Add/adopt/connect, access, health, goals, installed versions, latest trustworthy read | Overview, Plan, Work, Health, Changes and Settings |
| Routines | Definitions, schedules, enabled/paused state, next due, recent results; run, pause or change a supported routine | This project's routine definitions and history |
| Activity | Every observed attempt, source, trigger, stage, result, evidence and cost; filter by project/routine/model/date | Same feed and run detail, scoped to project |
| Learning | Lessons from projects, incoming proposals, decisions, guards, provenance and rollout | Lessons originating here and applicable lessons from elsewhere |
| Versions & updates | CLI/practice/lock versions, drift, available target, update previews, PRs and rollout results | Installed state, target diff, check results, resulting PR |
| Connections & capacity | Provider accounts, secret references, scopes, health, quotas, budgets and routing policies | Effective connections, inherited policies and narrower overrides |

Desktop uses persistent navigation, sortable tables and optional detail panes.
Mobile uses Home / Projects / Activity / More, full-page details and a persistent
project selector. Routines, Learning, Updates and Connections remain reachable
through More; do not cut features to achieve a narrow layout. Rows become labeled
cards with at least 44px touch targets, keyboard/focus support and text status.
A sticky action footer shows the actual operation, project and scope. Filters,
selected record and drafts survive navigation, backgrounding and reconnection.
Offline pages show their age; queue no consequential mutation silently for replay.
An expired session preserves a draft but requires fresh authorization and preview
before submission. Large logs are paginated, searchable and downloadable with
access checks, never mandatory to read before the useful summary.

## Routines and their runs

A routine definition names its owner, source config/revision, project, trigger,
schedule/timezone, worker adapter, inputs, permissions, budget and overlap policy.
Cover night/morning, checks, climb/tend, robot build/review, production collection,
verification, lesson collection, fleet updates and supported ad hoc CLI actions.
Show both the next scheduled opportunity and why it may not run. Paused,
disabled, blocked by budget, absent runner and missed schedule are distinct.

A run detail answers **what ran, why, what changed, what it cost, and what next**:

- Stable source run ID plus attempt number, parent/child runs, actor or schedule,
  routine version, project/ref, actual worker/provider/model and policy revision.
- Requested, queued, running, waiting for a person, cancellation requested,
  cancelled, succeeded, failed, skipped or uncertain state, with source timestamp.
  Provider state and Keel's interpreted outcome are both retained. Process success
  does not mean accepted, merged, production-verified or useful.
- Stage timeline, elapsed/queued time, sanitized logs, outputs, screenshots,
  test results, decisions, PRs and links to the authoritative external run.
- Reserved budget, measured usage, estimated cost and final provider cost when
  available, with units and attribution. A missing cost is unknown, never zero.
- Retry/cancel/reconcile controls only when the source adapter supports them.
  Cancellation requested is not cancellation confirmed. Retry is a new linked
  attempt; an uncertain write is reconciled before any new attempt can repeat it.

Ingest events and bounded historical backfills with cursors, stable identities,
deduplication, retention and per-source coverage. A workflow and its web dispatch
receipt are one linked operation, not two completed jobs. Reconcile after missed
callbacks and browser reconnects. Local CLI runs need opt-in authenticated runner
reporting; do not scan arbitrary local machines or upload transcripts wholesale.

## Execute work through supported workers

The Vercel app is the authenticated control surface. Long jobs run on an explicit
adapter such as existing GitHub workflows or an authorized local runner; worker
selection is a phase 104 decision, not permission to create another paid service.
Do not run long shell jobs inside request handlers or add a competing scheduler.
The UI edits the existing schedule's source through a reviewed operation. Display
schedule owner, timezone and overlap behavior before enabling or changing it.

Use a shared typed operation registry with argument validation, required access,
preview/effect description, source revision, adapter, recovery and receipt schema.
Separate reader, local mutation, external write, long job and owner-only operation.
Workers receive scoped, short-lived jobs for specific project/ref/operation tuples,
not an arbitrary shell string or the workspace's entire secret set. Revalidate
permission at dispatch and at worker claim. Refuse stale previews and expired or
revoked grants; do not give untrusted repository code workspace-wide credentials.

Reserve shared budget atomically before dispatch. Durable intents, idempotency,
leases/fencing, reconciliation and bounded concurrency survive duplicate clicks,
reconnects, worker loss and serverless restarts. Unknown dispatch delivery remains
uncertain until source reconciliation. A live lease prevents competing execution.
Do not create a second job merely because the browser timed out.

## Fleet versions, updates and learning

Show installed CLI/runtime version, adopted practice version and lock/source
revision separately, alongside intended target and compatibility. Freshness,
local drift, ejected/customized files and inaccessible repos remain visible.
“Current” needs a successful comparison against the chosen release/channel;
unknown state must not look up to date. The app's deployed version is another fact.

An update begins with a selected target and project set, a per-project migration
preview and expected checks. Respect `keel update` and `keel fleet update` domain
semantics: preserve project-owned files and deliver reviewable PRs. Revalidate
refs before dispatch, recover existing intents/PRs, use bounded rollout batches
and pause remaining projects on configured failure conditions. Offer a canary
project first. Never hide individual failures behind a successful batch toast.
“PR created”, “merged”, “installed version observed” and “verified” are separate.
Merging or a reverse change is its own explicit supported operation.

Fleet learning groups lessons by shape and applicability while retaining their
source project, evidence, decision and guard. Track a lesson from incoming proposal
to accepted practice, released version and projects observed using it. Existing
private/public destinations stay distinct: preview exact content and audience
before sharing a private lesson. An accepted lesson is not automatically published
or installed everywhere. Reuse the catalogue and lesson/update flows rather than
introducing a second authority for lesson decisions.

## Connections, keys and capacity

The dated [connection contract](web-connections.md) selects the initial adapters,
private policy, optional vault and activation proof for phase103.

Connect provider accounts once, grant selected projects access, and show effective
access in each project. The setup UI supports approved authentication mechanisms:
provider authorization where available, or write-only API key entry into the
selected secret store. Show label, account, credential type, allowed projects,
last validation, expiry/rotation state and revocation controls; never redisplay
stored secret values. Private Git stores references and policy, never keys.
Secrets must not enter logs, browser storage, URLs, exports or frontend bundles.
Provider write APIs and secret-store binding need a documented adapter and live
verification before enabling a form. No generic environment-variable editor.

A capacity observation names provider/account/credential scope, shared pool,
models covered, limit kind, units, measured remaining/used, reset/window,
observation time, source and confidence. Keep these distinct:

- Subscription entitlement and rolling usage windows.
- API request/token rate limits and reset timing.
- Billing credits/spend and the owner's configured budget.
- Runner concurrency and available execution time.

Never turn dollars, tokens, rate limits and percentages into one capacity bar.
Show a model's shared pool once with links, not independent fictitious quotas.
Provider adapters must prove which values they can read for the chosen auth type
using supported APIs. Some scopes may be unsupported; present unknown/stale or
an explicitly labeled manual observation, not a scraped or guessed allowance.
No promised universal subscription-quota API. The current `lib/quota.mjs` is a
GitHub API quota adapter, not model capacity; model observations are new work.
Read-only capability discovery precedes any provider-specific implementation.

## Model selection and automatic fallback

Policy is per task class (build, review, planning, routine) with workspace defaults
and explicit project overrides. Configure preferred model, allowed fallbacks,
minimum capabilities/context, privacy/provider constraints, budget ceiling,
capacity reserve, observation freshness, cooldown and what to do when unknown.
Automatic fallback is opt-in; show the effective policy before enabling it. This
product request authorizes building that control, not new provider spend or
transferring project data to an unapproved provider.

At dispatch, filter candidates by access and task requirements, independent-review
rules, approved data destinations, capacity freshness and budget. Select the
preferred eligible candidate, otherwise the first eligible fallback. If none
qualifies, queue until a known reset or ask for a choice; expose the reason and
estimated wait only when supported. Reserve capacity/budget across projects so
concurrent jobs do not each assume they own the same remaining allowance.
Use hysteresis/cooldown to avoid model flapping; exact defaults are decided with
real provider measurements, not invented from a percentage in this spec.

Pin the selected model for an attempt. A low-capacity alert cannot silently swap
a live agent's context. Switching at a supported checkpoint creates a linked
handoff with current revision, dirty state, owner decisions, outstanding effects,
actual usage and next action, then revalidates ownership. Unknown side effects
must reconcile first. A fallback must not make the builder its own reviewer,
lower required capability, bypass a provider limit with extra accounts, or switch
from subscription use to billed API use without an approved policy/budget.

Every selection has an explanation: preferred candidate, observed restriction,
chosen alternative, policy version, capacity timestamp and budget reservation.
Show it before Run and in run detail, with a supported override that remains
inside permissions and budget. Provider throttling is a recoverable condition,
not proof the task failed or permission for an unlimited retry loop.

## Delivery and proof

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| 102 | Unified routine catalogue and run history, including coverage gaps | 96 |
| 103 | Scoped provider connections, secret setup and honest capacity views | 95 |
| 104 | Durable run/cancel/retry and schedule operations through approved workers | 97, 102, 103 |
| 105 | Fleet version comparison, update PR rollouts and lesson propagation | 100, 104 |
| 106 | Policy-bound model routing, reservations and checkpoint handoff | 103, 104 |
| 107 | Complete operation mapping and mobile/desktop workflows | 98, 99, 105, 106 |
| 108 | Real fleet operation, failure recovery and capacity-policy trial | 101, 107 |

Phase 101 remains acceptance of the first workspace, not the expanded goal.
Each new phase has named tests and real-surface checks; those are planned tests,
not existing proof. Read-first surfaces can ship before worker controls. Phase 107
must map every current public command/subcommand/argument and installed routine
to a native workflow, supported worker/local bridge, presentation-only option,
or an explicit limitation with owner-visible reason and follow-up. A permanent
“copy this command into a terminal” cannot satisfy a core operating journey.
No arbitrary remote-shell escape hatch is needed for CLI parity.

End-to-end acceptance uses mobile and desktop on the same real fleet: investigate
a failed night, inspect its evidence, run a supported retry, review a lesson,
preview/update a selected project, check its observed installed version, inspect
capacity, and explain a policy-approved fallback. Include denied scope, expired
credentials, stale observations, exhausted budget, duplicate dispatch, partial
rollout, worker loss, offline reconnect and restore with unresolved jobs. Record
terminal detours and missing capabilities alongside time and actual cost; do not
claim full fleet control while a required operation still needs a terminal.

## Open decisions

- Provider/account support matrix, official quota sources and auth-specific gaps:
  settle in phase 103 with dated documentation and live reads; no assumed API.
- Worker adapters, required GitHub App permission additions, dispatch/recovery
  contracts and local-runner availability: settle in phase 104 before execution.
  The initial read-only App grant is not enough for writes or dispatch.
- Retention/backfill windows and artifact/log size limits: phase 102; cost/backup
  consequences must be explicit before enabling capture.
- Routing thresholds, capacity reservation estimates and settlement for unknown
  usage: phase 106; keep actual provider charges distinct from local reservations.
- Full operating trial window and fleet participants: owner selects in phase 108.
