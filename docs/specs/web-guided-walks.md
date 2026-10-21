# Hosted guided walks — phase 98

Implementation contract settled 2026-10-21. This extends the
[workspace contract](web-workspace.md) and [walk UX](web-ui.md#human-walks-the-signature-interaction).
It builds on phases 92 and 97; their private feedback and durable operation
boundaries remain authoritative. The first delivery supports local phase files.
Milestone-owned planning remains inspect-only; never mutate archived local files.

## Authored instructions and exact result

Project-owned `docs/walks/<id>.json` records supply version 1, a stable lowercase
ID, title, target phase path and SHA-256 of its exact acceptance-item text,
readiness, immutable result identity and 1–20 authored steps. A target digest
selects one unambiguous open human-walk item; derive its current box number from
source rather than trusting an old ordinal. Reject duplicates, unknown fields,
unsafe paths and malformed or oversized records (256 KiB maximum).

Readiness explicitly declares ready/not-ready and the author's reason. Check it
alongside the phase's date, waiting state, Your part conditions and dependencies
at preview and application time. Missing or unresolved readiness is a gap; a
browser clock or optimistic client state cannot make a walk ready.

Each step has a stable ID, instruction, expected observable result and zero or
more prerequisite step IDs. Validate references and cycles. Order is presentation;
identity is not the array position. The result names source revision, artifact
ID, immutable version, SHA-256, repository-relative artifact path, intended
environment and optional safe HTTPS preview link. Verify the GitHub source
commit/blob and bounded bytes (initially at most 256 KiB), then retain them
privately. Never fetch arbitrary URLs. The preview link is a convenience, not
proof that it still serves that revision. Label serving-version confirmation as
the owner's observation unless independent serving evidence actually exists.
Require explicit actual environment and confirmation of the displayed result
before observations can contribute to acceptance.

Free-form phase prose is not a runnable script. Missing authored steps, result
identity or bytes produces a useful authoring/coverage gap. Do not synthesize
expected behavior, a successful observation or an estimate of time required.

## Private drafts and feedback

Use an encrypted hosted adapter to phase 92's pure capture, event, replay and
immutable-result model. Step notes live in that feedback history, not a second
raw-note store. Draft metadata references step IDs, outcomes, feedback IDs,
source/definition fingerprints, actor and environment. Retain exact result bytes
under the same private boundary. Authenticated session identity scopes access;
manual observations still do not become machine-verified serving evidence.

Persist drafts in Supabase through a narrowly scoped migration/RPC with RLS and
role denial, encryption, bounded values, actor/project/workspace scope and
compare-and-set revisions. Cap the store at 1000 drafts and 50 MiB encrypted
values; a draft is bounded to 1 MiB before encryption. Refuse capacity visibly
without deleting history. No automatic expiry of unresolved observations.
A competing tab receives a conflict and reload/review path, never last-write-wins.
Draft writes retain their captured source; they need not reread every GitHub blob
for each keystroke. Detail refresh, final preview and application revalidate
current sources and authorization. Missing storage is unavailable, not an empty
saved draft.

A step can be unobserved, pass, fail or blocked. No success is preselected.
Passing may have optional detail; the explicit “This works” response is itself
an attributed observation. Failure needs what happened instead; blocked needs
the reason testing could not proceed. Preserve partially typed notes across
reload once saved, and show saving/saved/conflict/error state honestly. Failed
steps do not prevent testing independent steps, but prerequisites must succeed
before a dependent step can contribute to acceptance.

Changed result/build or actual environment requires fresh current outcomes and
preserves prior observations as history. Reordering identical stable steps does
not discard observations. Changed instructions/expectations/prerequisites
invalidate affected outcomes; never silently carry successful observations onto
a different build. Editing after final preview invalidates that preview.

Failure/blocked observations have a source-preserving record-only path: the
private draft and phase-92 feedback history. They never call `walk done`.
Offer an explicit repair-brief preview with the selected actual observation,
original result/environment/step and source links. Reuse phase 92's normalized
issue/shaping handoff and existing issue identity/recovery, with fresh facts;
no new issue journal, GitHub issue POST or agent launch belongs to this slice.

## Successful acceptance and recovery

Only complete, current successful steps, satisfied prerequisites, explicit final
owner observation and a source-valid choice (when the phase requires one) can
produce an acceptance preview. A choice that keeps the walk open cannot be used
as successful acceptance. Do not infer choice effects from their labels.

Extract a pure write-plan from the existing CLI `walkDone` implementation and
reuse it in both places. Preserve selected-box, choice, evidence append and
last-open-box status semantics. Validate the phase inventory/goals and regenerate
the roadmap with its existing pure renderer. Hosted requests execute no project
scripts, shell, Git process or arbitrary repository code. Only the selected phase,
its evidence and generated roadmap may change. Other acceptance items remain
unchanged; the existing final-box rule may move the phase to built, never lived-in.

The final preview displays every changed file and exact content, the consequence,
selected observation text, repository visibility and source identity. Public
publication needs explicit acknowledgement of these exact bytes. Bound the
combined changed content to 384 KiB and the file set to the three named records.
Preview persistence is not source delivery or acceptance.

Extend the existing phase-97 operation pipeline and GitHub adapter to bounded
multi-file intents while retaining single-file decision behavior. One conditional
`createCommitOnBranch` addresses the immutable Ref ID with expected HEAD. Recovery
checks repository/Ref identity, exact parent and marker, changed-file count and
every resulting blob/hash/byte, including a newly created evidence file. Reuse
project reservation, fencing, original operation URL and uncertainty handling;
never submit a second mutation because a response was lost. Keep independent
source/write/recovery deadlines inside the existing request bound.

Coordinate draft saves with the same SQL advisory lock used for operation
reservation. While a live prepared, dispatched or uncertain project operation
is reserved, draft mutation refuses. Apply reserves first, then checks the exact
current draft digest before dispatch. An expired never-dispatched preparation
may release; dispatched/uncertain reservations do not expire. This prevents a
newer failure from being saved between validation and source acceptance.

Hosted confirmation says source commit verified only after its durable receipt.
The local board continues to say recorded locally/uncommitted for CLI writes.
Submission stays disabled by default under the existing write-permission opt-in.
Read-only GitHub App approval grants no Contents write access or owner choice.

## Browser and proof

Provide an authored-walk index and project/Home links. A desktop detail view and
mobile page show the exact phase/item, authored instruction and expectation,
result revision/environment, actual observation and accessible step navigation.
Keep expected behavior distinct from actual text. Show counts such as “2 observed,
1 failed” rather than a completion percentage that hides failure. Final review
shows all steps and the exact source change. Save failure and blocked results as
useful outcomes while acceptance stays open.

Use actual web routes/modules in browser proof with synthetic Acme provider/storage
adapters; do not replace the application with a static mockup. Tests must cover
reload, stale source/result, reorder/change, concurrent tabs, role/scope denial,
public preview acknowledgement, all outcome gates and uncertain multi-file writes.
Run the SQL migration against a real PostgreSQL-compatible engine independently,
then the hosted role/concurrency proof when access is available. The real owner
walk and approved GitHub write remain named manual evidence; synthetic tests do
not establish them. Media upload/gallery is phase 99, not an implied new resource.
