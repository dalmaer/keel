# Decisions survive the work, and feedback reaches the next change

Authorized for implementation, 2026-10-20. This document specifies intended
behavior; phase evidence records what is implemented. Baseline: keel `3d7afc95ec8e482c217bac537151bc8a41fc9658`.
This spec uses keel's public contracts and synthetic examples.

## Outcome

An owner can see why a change is being built, correct that reasoning, and give
feedback on the exact result they saw. The next builder receives the current
choice and the evidence for it, without mistaking a suggestion for approval.

Build in this order:

| Phase | Result | Existing mechanism extended |
| --- | --- | --- |
| 90 | A builder receives current, scoped decisions and explicit gaps | Reconciliation, conduct, robot briefs, session handoffs |
| 91 | An idea becomes a reviewable plan with attributed choices | Phase templates, reconciliation, robot issue preview |
| 92 | Feedback names its result version and becomes reviewed follow-up work | Canvas receipts, robot issue intents, board |

Start with phase 90. Phase 91 can work entirely in local files. Phase 92 starts
with explicit local input and the existing canvas binding; automatic comment
collection is a later capability-gated adapter, not a prerequisite.

## What already exists

All references below were read at the baseline revision.

- [Reconciliation](../reconciliation.md) already makes accepted anchored
  decisions authoritative, supports scope-specific supersession and rejects
  stale correction proposals. Reuse its parser and semantics.
- [The decision template](../templates/reconciliation.md) has `keel-decision`
  version 1, scope, owner/date and reciprocal replacement links. An accepted
  successor can replace only part of a previous decision's scope.
- [Phase 87](../phases/87-builders-restate-what-done-means-first-and.md)
  already requires a restatement of success and a consistent builder report.
- [Session handoffs](../phases/72-session-handoffs-improve-through-bounded.md)
  preserve owner choices and revalidate ownership. A decision bundle adds
  source validation; it does not replace claims or authorize resumption.
- [The canvas contract](isocan-project-canvas.md) already treats cards as
  projections, retains versions and protects human edits. Its comments do not
  accept source work. Keep that boundary.
- `lib/robot-issue.mjs` already previews a rubric and journals an issue intent
  before POST. `lib/canvas-retro.mjs` already validates explicitly captured
  records. Extend those patterns rather than introducing another work queue.

The gap proposed here is a connected path through these mechanisms, not a
claim that keel lacks decisions, plans, a board or feedback altogether.

## 90. Resolve decisions into the work

### Read contract

Add proposed `keel decision context --phase <id> --json` and
`keel decision context --issue <owner/repo#n> --json`. These are read-only.
The phase form reads explicit reconciliation references. The issue form reads
explicit decision references from the rubric/impact metadata, never inferred
from arbitrary issue prose. No repository-wide semantic search or private
transcript ingestion is necessary.

The result has `schema: 1`, `target`, `revision`, `sources`, `decisions`,
`proposals`, `gaps` and a deterministic content `digest`. Each source names a
repository-relative path, explicit anchor and blob/content hash. A decision
contains its stable reference, applicable scope, attributed owner/date,
statement, and the supersession chain used to select it. Source prose remains
authoritative. This bundle is a derived view, not a second decision database.

Resolve partial replacement by scope: replacing Acme's storage choice for
`authored-data` leaves its `cache` choice intact. Proposed replacements do
not displace accepted decisions. Overlapping accepted successors without an
explicit resolution, cycles, missing reciprocal links, duplicate IDs, missing
anchors and unreadable inputs produce named gaps. Never select whichever
record was read last. No references is `not-configured`, not verified coverage.

Bound reads to 100 records, 2 MiB total and 20 supersession hops. Exceeding a
bound is incomplete coverage. Reject paths escaping the repository and
symlink traversal. Do not fetch arbitrary URLs while resolving local records.

Exit 0 means complete or explicitly not configured, 1 means contradictory
records, 2 means invalid input or unavailable required sources. JSON always
names the state. Existing projects without decision references keep working.
A target with broken explicit references cannot start or resume builder work
until the source record is repaired or the target is explicitly revised.

### Handoff contract

Include the bundle in the conductor brief and robot brief, separating accepted
choices, proposals and unresolved choices. Before dispatch or resume, verify
its source hashes and target revision. Recompute on change. At the next safe
boundary, a running builder reports a changed decision for reconciliation;
this feature does not terminate processes or roll back code automatically.

The phase-87 report names the decision digest it used and any apparent conflict
with the task. Text attributed to an owner in an external comment is not proof
of approval. Existing owner actions and recorded source decisions establish
that authority. Bundles confer no merge, deployment or spend permission.

## 91. Shape a bounded plan without losing the choices

Use an optional local `shaping` practice and an agent guide. The CLI validates
and renders supplied structured records; it launches no model and schedules
nothing. The guide has the agent inspect the named source records before
asking questions. Ask only for unresolved aims, taste, authority or resources;
record ordinary implementation choices as recommendations with reasons.

Proposed commands, all with `--json`:

- `keel shape check <file>` validates without writing.
- `keel shape render <file> --output <new-directory>` renders a local review.
- `keel shape plan <file>` previews phase drafts and/or robot rubrics.
- `keel shape plan <file> --yes` writes the exact reviewed drafts locally.

A version-1 record has an ID, revision, goal, bounded source references,
questions, answers, proposed decisions and work items. Each question has a
stable ID, why it requires the owner, a recommendation with evidence and
alternatives. Unanswered remains unanswered. An answer records its actor,
time and source; an agent recommendation is never labelled an owner choice.
The tool validates attribution fields but cannot authenticate their truth;
the conductor must retain the actual owner instruction when recording them.

Each work item has a stable ID, problem, scope, Done when, named proof,
dependencies, decision references and owner prerequisites. Validate unknown
references, dependency cycles and duplicate IDs. A structural check proves
that a proof was named, not that the proof is adequate. Require conductor
review of that distinction. Limit a record to 12 questions, 20 work items and
256 KiB; these are design bounds, not measured product limits.

Owner acceptance is scoped to the reviewed content digest. A changed source,
question, answer or plan invalidates the affected preview. Unrelated accepted
choices remain. Revising a choice proposes a new anchored decision with
reciprocal scoped links; it never overwrites the old reasoning or silently
accepts its replacement. Phase 90 resolves the final source records.

Generated phase files are seeded project work. Never overwrite an existing
phase. Keep a stable item-to-path receipt so a retry returns the same result.
Journal a multi-file write before starting it and recover partial completion
by hashes; a changed destination stops recovery. For milestone-backed planning,
produce a preview of remote work only; do not seed archived local phases.
External issue creation stays in the existing issue-authoring flow with an
explicit destination and its existing authorization checks.

A local review renders the outcome, decisions, unresolved owner prerequisites
and work items. Taste questions may link explicitly supplied local previews;
this phase does not build an artifact host, execute arbitrary HTML in the
board, or require a new visual editor.

## 92. Feedback is about a particular result

Proposed `keel feedback capture <file>` previews a version-1 record;
`--yes` stores it in `.keel/feedback/` with restricted local permissions.
`keel feedback list --json` reports pending, linked, declined, superseded and
unavailable items. `keel feedback propose <id>` prepares a reviewed follow-up
through the existing robot rubric, with no issue creation or model launch.

A record contains a stable ID, project identity, explicit author/source,
observed time, the person's words and `result`: source revision, producing
phase/issue/PR where known, artifact ID, immutable version and content hash.
It may name an anchor within that version. An explicit local file plus its
content hash is enough for the first slice; a provider URL without a resolvable
version is incomplete. Never substitute the latest version for the one seen.
Manual attribution is labelled manual, not provider-authenticated.

Preserve a bounded local snapshot/reference to the reviewed result under the
same retention policy as its feedback. If it is no longer available, show a
gap and require the owner to identify the intended result before proposing
work. Provider bindings use the existing canvas identity and receipts. Missing
capabilities are unavailable, never an empty inbox or permission to scrape.

Routing is a proposal:

- An open work item gets a proposed follow-up referencing its original result.
- Closed work gets a new proposed repair or change with the old work linked.
- Feedback contradicting an accepted decision proposes reopening that decision
  through phase 91. It cannot supersede the decision on its own.
- Fresh GitHub facts are required before a remote route is applied. Unknown
  closure state stops routing. Reuse the robot issue journal for uncertain
  writes; retries must not duplicate an issue or relaunch a session.

Deduplicate by project, source ID and result version. The same source ID with
changed text is an explicit revision retaining prior text, not a new work
item. A different version is a different observation. The board adds a small
"Feedback to review" section to its existing owner view; no second dashboard.
Resolution names the resulting proposal/issue or a dated decline reason.
Closing an issue never claims the owner is satisfied or the phase accepted.

Raw words and result snapshots stay local by default and are excluded from
Git, canvas snapshots, night artifacts and logs. Any outbound preview shows
exactly the selected excerpt and destination. Existing publication approval
applies to that payload; an approved canvas binding alone does not authorize
publishing feedback. Retention defaults to no automatic deletion of unresolved
items; capacity exhaustion refuses new storage visibly. Keep at most 256 KiB
per feedback record and 2 MiB per selected result. Deletion/export policy is
explicit owner work, not a silent cleanup job.

### Phase 92 implementation contract — 2026-10-21

The local CLI is `feedback capture <file>`, `feedback list`,
`feedback propose <id> --record <publication-file>` and
`feedback resolve <id> --record <resolution-file>`. All accept `--json`.
Capture and resolution preview without writes; `--yes --digest <preview-digest>`
applies exactly the reviewed local change. Propose is read-only and never creates
an issue, starts an agent or changes source acceptance. Pure validation, identity,
revision and routing logic must remain usable with a different private store for
phase 98; filesystem and provider adapters are separate.

An authored schema-1 capture names its project repository (matching the local
Keel config), stable source ID, manual author attribution, observed UTC time,
words, revision and previous digest. Its result names a full source commit,
artifact ID, immutable version, content hash, optional exact local file, optional
phase/issue/PR reference and anchor. Explicit accepted-decision conflict references
and an owner's explanation are optional; semantic conflicts are never inferred
from text. Unsupported provider-only references can be retained as unavailable
observations, with gaps. They cannot silently resolve to the latest version.
A local result is verified from explicitly selected bounded bytes against its
SHA-256 identity, then retained privately. Existing canvas binding/receipt identity
can be recorded only using its actual schema; without exact version bytes the
adapter remains unavailable. No comment scraping or new provider API is implied.

Observation identity derives from project, source ID, artifact ID and immutable
result version. Identical input is unchanged. Changed words require the next
revision and exact previous digest, preserving earlier words and resolutions.
One immutable version cannot acquire different bytes. A different result version
creates another observation. Revisions are appended atomically under a local
writer lock; concurrent or stale revisions refuse instead of overwriting.
A verified retained snapshot survives deletion/change of the original pathname.
A missing or corrupted retained snapshot is a gap and prevents a proposal.

The private store defaults to `.keel/feedback/`. Before persisting any raw bytes,
verify that it is untracked and Git-ignored, adding only a local Git exclude when
needed. Refuse unsafe or already tracked storage. Private directories use 0700,
files 0600, and symlink/hardlink aliases are refused. Previews create neither
storage nor exclusions. Store at most 1000 observations and 50 MiB total, with
the existing 256 KiB record and 2 MiB selected-result limits. Count existing
revisions/snapshots, refuse visibly at capacity, and never delete to make room.
Diagnostics, capture/list output and board projections contain identifiers,
states, gaps and resolution links, not raw words, snapshots or private paths.
Only an explicit publication preview may show its selected outbound material.

A publication record binds the current feedback digest, selected exact excerpt,
explicit destination and an authored robot rubric/title. The first destination
is the same configured repository; arbitrary cross-project routing is unsupported.
Resolve current GitHub issue/PR state freshly when a work reference is present:
open proposes follow-up, closed proposes a linked repair/change, unavailable state
blocks routing. Local phase references are planning context, never GitHub closure
or acceptance facts. Explicit conflicts must resolve to currently accepted
canonical decisions and produce a reopening proposal for phase 91, never an
accepted replacement. Broken required references block the proposal.

For an issue proposal, reuse the exact normalized rubric, subject and instance
identity derivation used by `issue new --agent`. Its output includes the exact
outbound body, destination, source/result links, routing/context facts and one
preview digest, plus the existing issue command's handoff inputs. Do not create
a competing issue journal. Delivery remains a separately authorized `issue new`
operation with fresh policy checks and its existing uncertain-write recovery;
feedback preview is not delivery approval. Test that the handoff retains the same
preview/intent identity and recovery behavior through the existing issue API.

A resolution record binds the current feedback digest and explicitly names
linked, declined or superseded, manual actor and UTC time. Linked requires a
resulting proposal/issue reference; declined requires a reason; superseded names
another existing observation for this project. Resolution history is retained.
An edit after resolution returns the new revision to pending without rewriting
the earlier outcome. Unavailable is a derived coverage state, not a fabricated
owner resolution. The existing board adds only a bounded metadata summary under
Feedback to review; raw private content remains outside canvas/night exports.

## Boundaries and rollout

No new scheduler, agent budget, phone client, artifact hosting service or
production monitor. Existing production and delivery phases retain their
acceptance gaps. No automatic phase completion, decision acceptance, issue
creation, merge or deployment follows from feedback or a rendered plan.

Ship phase 90 first as an opt-in extension to reconciliation. Exercise local
shaping next. Add feedback capture only after result identities and review
receipts are proven. Adapter implementation must verify the installed public
canvas API before claiming comment collection works. Model-independent local
fixtures remain the baseline; live writes require an approved throwaway
private destination and separate evidence.

Measure usefulness during an explicitly authorized walk: which owner questions
were repeats, whether a builder used an obsolete decision, and whether a
follow-up referred to the wrong result. Keep unknowns unknown. Do not promise
time savings until a comparable baseline and observation exist.
