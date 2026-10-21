# Routine definitions and observed history

Phase 102 implementation contract, 21 October 2026. This settles the read-side
choices in [fleet operations](web-fleet-operations.md). Execution, retry, schedule
edits and worker reporting remain phase 104. This surface must answer what ran,
why, what happened, what evidence remains and what is unknown on both phone and
desktop.

## Sources and authority

| Source | Read | Authority and gaps |
| --- | --- | --- |
| GitHub workflows | Selected repository workflow inventory and immutable workflow files | Provider enabled state and authored triggers are different facts. Unknown YAML semantics, schedules, permissions, inputs or concurrency remain unknown; never execute project scripts to resolve them. |
| GitHub runs | Retained logical runs, individual attempts, attempt-scoped jobs/steps and run-scoped artifact metadata | Provider execution status, not Keel acceptance. Old reruns remain eligible; an unvisited page can contain a recent rerun. |
| Night plans | Validated retained `docs/night/*.json` and the existing Daily reader | Authored item outcomes, not independently observed execution attempts. Preserve source revision and link to the full Daily view. |
| CLI receipts | Supported, validated receipt files only when present in the selected immutable repository source | Local machine history is not connected. No filesystem scanning, transcript upload or invented receipts. Unsupported records are explicit gaps. |
| Web operations | Existing encrypted decision/walk/migration records and configured media receipts | Original operation state and receipt, with actor/project authorization. Reading history never dispatches or reconciles a write. |

Source identity is a tuple, encoded without delimiter ambiguity. An Actions attempt
is `(repository numeric ID, run ID, attempt)`, with an explicit logical-run parent;
the first attempt is not a retry. A source record without an attempt identity stays
an authored observation. Deduplicate equal identities and link a dispatch receipt
to a provider run only with exact validated repository/run/attempt coordinates.
Never join by title, date, branch or a similar-looking URL. Conflicting duplicate
facts produce a gap rather than a silent winner. Future dispatch receipts may use
this model; phase 102 does not invent any.

The original provider status/conclusion, interpreted state and acceptance are
separate fields. A successful process or committed web operation establishes no
acceptance. Unknown model, worker, parent, actor or cost stays unknown. Source text
is data; render it as escaped text and construct provider links from checked IDs.

## Bounded reads and history

No new persistent run mirror, webhook receiver, scheduler or automatic artifact
capture is created. Historical backfill is explicit pagination against retained
sources. The provider owns retention; deleted runs and expired artifacts cannot be
recovered. The UI names the read time, requested window, page bounds, observed
range and every unvisited or unavailable source. A complete page is not a complete
history or an immutable snapshot. Inserts between reads may shift provider pages.

The default visible window is 30 days; explicit windows are 1–90 days. Active
attempts and unresolved private operations remain visible regardless of their
record age; an uncertain effect is not labeled as running execution. Completed observations
use their latest valid provider activity or record timestamp, with its basis
shown; a long-running attempt must not disappear solely because it started before
the window. Unknown times remain visible as unknown. Fetch run
pages without a created-at lower filter: older logical runs may have new attempts.
Read 20 logical runs per page and at most the newest 10 attempts per run; older
unread attempts remain counted as gaps and reachable through explicit attempt
detail. The shared source-collection bound is 80 API calls, 8 MiB response bytes
and 25 seconds. Fresh authentication retains its separately bounded existing
transport; the route's existing 55-second deadline covers authentication and
collection together. Stop before a bound and report partial coverage. Detail reads paginate
jobs and artifacts, at most two pages of 100 each per request. Do not silently
truncate stages, artifacts or attempts. A continuation validates its repository,
source and filters; it never grants access or supplies an arbitrary URL.

Fleet reads visit at most three projects per request, sequentially, so one large
project cannot starve all the others. Every unvisited authorized project remains
visible with its next-page path. Date/routine/state filters apply to observed
records, with a clear note when source pagination is not exhausted. Fleet totals
are counts of deduplicated observed records, never fabricated fleet-wide totals.

Repository-source inventory shares the existing bounded immutable reader. Read
at most 30 workflow files, 30 dated night records and 30 supported archived CLI
receipt files per project, each at most 256 KiB and 4 MiB in aggregate. Canonical
plan validation is reused. Invalid, absent, too-large and inaccessible records
remain distinct. Local CLI reporting is unavailable until an authenticated runner
bridge exists; absence in Git is not a claim that nothing ran locally.

## Routine definitions and cost

Definitions retain source path/revision, configured triggers, schedule/timezone,
worker adapter, permissions, inputs, budget and overlap observations where known.
Reuse `workflowTriggers`, `ciOptions` and `runnerUsage`; their restricted inputs
do not establish full YAML semantics. Conservative extraction may expose simple
literal schedules with their source. Expressions, anchors and unsupported shapes
must not become a guessed next run. A provider-disabled workflow, no observed
runner, an unknown schedule and a configured budget are distinct. Link all
unresolved details to the immutable authored source.

Show job/step stages, start/end times and validated elapsed time. Queue time is
unknown unless the source gives a meaningful attempt-specific requested time.
Reuse existing runner weighting rules for clearly labeled usage estimates when
the required job evidence is complete. Unknown runner weights, unfinished jobs,
missing attempts or incomplete pages keep totals unavailable. A subtotal of
observed jobs can be labeled as such. Weighted minutes are not an invoice, dollar
cost, model tokens or a provider quota; do not combine them. Actual provider/model
charges remain unknown without a supporting receipt.

Run artifact metadata does not inherently identify the attempt which produced it.
Keep run-level evidence unassigned unless validated provenance proves the attempt.
Expired/missing artifacts stay visible with that state. Raw archives and logs are
not downloaded or rendered by this phase; source links expose their authoritative
provider viewer. Do not return transient signed download URLs, tokens or raw
operation payloads to the browser.

## Private operation history

Add a read-only, bounded list RPC over existing operation tables, without changing
their mutation or recovery semantics. Restrict execution to the server role;
anonymous/authenticated roles and direct table access remain denied. Use the exact
actor/project domain already used by the operation store. Migration scope remains
separate. Validate decrypted identity and payload before projecting a minimal
summary; never include preview file contents or unreviewed private lesson text.
If a migration involves projects whose access has been removed, suppress their
details and preserve a coverage gap. Do not widen an actor-specific receipt into
a workspace-wide event just because the server can decrypt it.

Pagination uses bounded validated identifiers and a stable database ordering.
Existing operation rows lack an observed execution-start timestamp: a preview
expiry minus its lifetime is only an inferred record-time basis and must be
labeled as such. Retain existing rows; phase 102 adds no purge. Missing migration
007 or a configured store outage is unavailable history, not an empty list.
Media retains its existing project authorization and retention semantics.

## Authorization and UX

Fresh membership, repository numeric pins and App grants govern every page and
detail read. Expose the observed Actions permission from authorization. Without
Actions read, show the capability gap and source definitions which Contents read
can support; do not substitute an owner CLI token or anonymous private request.
Mid-read access revocation denies private output. Quota throttling is a bounded
pause with explicit coverage, not a successful empty source. A new Actions-read
grant needs owner approval and an actual App read before claiming hosted access.

Actions reads use the pinned numeric repository route
`/repositories/{id}/actions/...`. On 21 October 2026, actual read-only requests
verified workflow/run lists, named attempts, jobs and artifact lists through this
route. GitHub's reference documents owner/name routes; numeric-route compatibility
is an observed capability, not a documented permanence claim. A refusal produces
an unavailable source without a fallback to a potentially recycled repository
name. Returned run/repository/attempt identities still require validation.

Provide Routines and Activity in fleet and project lenses, preserving applicable
URL filters. Lists summarize outcome, project, source age and cost confidence;
details expose stages, original status, attempts and evidence. On mobile, labeled
cards replace wide tables, controls have at least 44px targets, and every feature
remains reachable. Use text status and keyboard focus. Refresh performs a fresh
authorized read; it never retries a job. Links to an original uncertain receipt
remain available without a second write. No run/cancel/retry buttons imply a
worker that phase 104 has not enabled.

## Proof and remaining activation

Named tests exercise the real transport adapters at their network boundaries:
duplicate/conflicting identities, old-run retries, absent optional job attempt
fields and present mismatches, pagination drift, budgets, expired artifacts,
unknown costs, denied scopes, runtime receipt ordering and source-only outcomes.
SQL proof covers role denials, bounded actor-scoped listing and unchanged operation
recovery. Browser proof exercises the actual routes on desktop and a narrow
viewport, preserving filters and displaying failure and coverage details.

Compare selected real GitHub runs and attempts with independent API reads,
including failure or skip. A CLI-token inspection proves API behavior only;
hosted App permission, migration activation and owner phone/desktop use are
separate evidence. Keep the phase partial until the named owner walk is complete.

Primary API contracts consulted on 21 October 2026:
[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs),
[jobs](https://docs.github.com/en/rest/actions/workflow-jobs),
[artifacts](https://docs.github.com/en/rest/actions/artifacts).
