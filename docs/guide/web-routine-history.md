# Routines and observed activity

Open **Routines** or **Activity** from Home. The Fleet / project selector keeps the
current destination and applicable time-window and outcome filters in the URL.
A routine's workflow path is project-local, so changing projects clears that
selector and any source-bound pagination. All controls are read-only: refreshing
history does not run, retry, cancel or reconcile work.

## Inspect a routine

Routines show the observed workflow definition and provider enabled state beside
its immutable source. Declared triggers, literal schedules and budgets are not
proof that a runner is connected or that the next run will happen. Unsupported
YAML expressions and unresolved permissions, inputs, overlap or timezone remain
unknown. Use the source link to inspect the declaration; no repository script
runs in the web request.

Actions access requires an approved GitHub App Actions-read grant. Without that
grant, the view names the capability gap while retaining definitions that Contents
read can support. There is no token-entry form and no fallback to an owner's CLI
credential. Changing App permissions remains a separate owner-approved action.

## Inspect an attempt

Activity keeps the original provider status and conclusion, interpreted outcome,
project, read time and source identity. A retry has its own attempt identity and
retains its logical-run parent and preceding-attempt identity. Open an attempt
for its jobs, steps, elapsed time and retained artifact metadata. An execution
success or committed web operation is not project acceptance.

Usage estimates, partial job subtotals and actual charges remain distinct. Weighted
minutes use existing runner weights; they are not invoices, token counts, dollar
costs or a remaining quota. Missing evidence keeps the estimate or charge unknown.
Queue time is not inferred from a logical run's creation date.

Artifacts can belong only to the logical run when no checked provenance assigns
them to an attempt. The view labels that assignment and retains expired metadata.
Provider links open the authoritative viewer. This phase downloads no archives,
raw logs or signed URLs.

## Read coverage alongside results

The default visible window is thirty days, with explicit windows from one to
ninety days. Filtering happens over bounded observations. Old logical runs can
have recent retries, so reading only a recent creation-date range would miss work.
Continue through provider pages and explicit attempt details when older history
is needed. Inserts between requests can shift provider pages; a complete page is
not a complete immutable history.

Fleet reads visit at most three authorized projects sequentially in one request.
Unvisited projects remain visible with project links and a next-batch control.
Each project's provider and private-receipt continuations keep their own scope.
A cursor is not permission and cannot be moved to another project or filter.
Changed immutable source records require restarting that receipt read.

The source-collection budget is eighty calls, eight MiB and twenty-five seconds.
Bounded, throttled, unavailable, absent and invalid sources remain gaps. Fleet
counts describe only deduplicated observed records. No matching results is not
proof that nothing ran. Local-machine CLI history remains disconnected until an
authenticated reporting bridge exists.

## Distinguish authored records and private receipts

Retained validated night items and supported archived CLI summaries are authored
observations, not independently authenticated execution attempts. Original states,
source revisions and declared allocations remain separate from actual usage. A
night observation links to the project's full Daily view. Unsupported archived
formats are explicit gaps; there is no scan of local files or transcript upload.

Private history lists only minimal authorized receipt projections. Decision/walk
operations retain their actor/project scope; private workspace migrations are
listed separately. A missing history migration or unavailable store does not
become an empty-success response. Inferred record time is labeled as inferred;
it is never an execution-start timestamp.

Activity does not recover or reconcile operations. Follow the original receipt
link to inspect that operation separately. Keep its identity after uncertainty;
reading history is never permission for another submission. Preview contents,
private lesson text, raw failure payloads and credentials are not returned here.

## Implementation and activation

This guide describes the source implementation for phase 102. It is separate from
the production deployment; source implementation and hosted activation are
tracked independently in each phase record. Hosted routine history
needs its own deployment, approved Actions-read grant, read-only history database
migration and actual App/API checks. The owner then compares real attempts,
including a failure or skip, from desktop and phone. Synthetic browser and adapter
proof does not replace that exercise.

See the [routine-history contract](../specs/web-routine-history.md),
[phase status](../phases/102-routines-have-a-complete-observed-history.md) and
[fleet operating plan](../specs/web-fleet-operations.md). The separate [durable worker controls](web-workers.md) require approved
registration, live activation and budget; these inspection pages do not grant
execution authority.
