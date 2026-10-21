# Plates web UI: a home for the fleet

UX specification, revised 21 October 2026. The owner authorized phased
implementation. Hosted access and public-code/private-data separation are
specified in [the workspace contract](web-workspace.md). UI behavior below is
a design contract, not a claim of implemented functionality. Original CLI audit:
`d60ea553f51d9a0ee8558b706de8f7526e28777c` (CLI 0.8.32).

## The product

Open Plates and know which projects need you, what changed while you were away,
what can move without you, and what is still unproven. Go from that overview to
the evidence and the appropriate action without reconstructing a project's
story from terminal output.

The starting point is **Home**, organized around **decisions that need you**,
**guided things to test**, and **recent additions you can see and try**, with
rich project summaries underneath. Plates's organizing idea is responsibility:
whose turn is it, what do they need, and what will their action change?

The owner emphasized these three experiences during design review on 20 October
2026. They now lead the proposal and the next prototype iteration; this is a
product preference, not acceptance of an implementation.

The full goal is to operate every authorized Plates project from mobile and desktop,
with fleet and project lenses for routines, learning, updates, connections and
model capacity. [Fleet operations](web-fleet-operations.md) specifies this
expansion; Home remains the first shipping screen.

The web UI projects the same records as the CLI. It does not introduce another
phase status, acceptance database, task tracker, or agent scheduler.

Companion: [command and argument UX inventory](web-ui-command-map.md).
The accompanying Home mockup uses illustrative Acme projects; it is not a live
fleet report. No project was changed or production service contacted to design it.

## Starting from what exists

| Existing surface | Reuse | Missing for this experience |
| --- | --- | --- |
| [`board`](../../lib/board.mjs) and [guide](../guide/the-board.md) | Responsibility lanes, Your part, readiness, choices, phase details, action results, source gaps, local authenticated server | A consistent project identity on every item; fleet-wide project summaries and local-root routing; durable action identity beyond array indices |
| [`fleet`](../../lib/fleet.mjs) | Repository identity, practice versions, health, CI, machine PRs | Full per-project walk/goal/agent context; accessible local-checkout mapping; independently refreshed detail |
| [`status` / `next`](../../lib/cli.mjs) | Derived goals, planning-source variants, free and claimed phases | Unified presentation across local phases, projects shape, and milestones |
| [`morning`](../../lib/morning.mjs), [`goodnight`](../../lib/goodnight.mjs) | Outcomes, unfinished work, draft plans and budgets | Fleet morning brief and guided evening planning |
| [`canvas`](isocan-project-canvas.md) | Provenance, history, gaps, bounded projection, recovery concepts | A daily working application; canvas remains an optional publication destination |
| [`production`](production-errors.md), [delivery](../guide/delivery.md) | Separate serving-revision, smoke and error-window evidence | A coherent delivery view that exposes uncertainty without reading multiple reports |

Extend the board incrementally. Retain `plates board`, its JSON interface, and its
local operating model. Do not ship a second competing dashboard with separate
classification rules. The fleet strip today is not a full fleet of project boards:
aggregation and capability discovery are real backend work.

## Information architecture

App navigation: **Home · Your actions · Projects · Routines · Activity · Learning ·
Versions & updates · Connections & capacity**. Use a persistent Fleet/project lens.
On mobile use **Home · Projects · Activity · More**; all destinations and actions
remain available. See the fleet operations contract for the responsive structure.

Within a project: **Overview · Plan · Work · Routines · Activity · Health · Changes ·
Learning · Settings**; versions, effective connections and capacity are available
from Settings and contextual links.
Keep tabs stable; an unavailable feature explains what is missing. Hide irrelevant
advanced controls rather than invent empty scores. Global search finds projects,
phases, walks, PRs, proposals and evidence; results include project and source.

| Destination | Main question | Contents |
| --- | --- | --- |
| Home | What should I know and do across my projects? | Attention, project summaries, changes, background work, source freshness |
| Your actions | Which human action can I finish now? | Ready walks, decisions, reviews, setup, stale claims, blocked actions; filters by project/type/readiness |
| Project overview | Where does this project stand? | Goal, current work, its human asks, delivery, health, last night, next action |
| Plan | What outcome are we working toward? | Goals, phase list, dependency view, acceptance, evidence, deferred decisions; milestone links when externally owned |
| Work | Who or what is doing it? | Claims, ready branches, PRs, reviews, loose ends, night plan and outcomes, delivery |
| Health | What is getting worse or remains unknown? | Measures with bounds, production incidents, test history, performance, drift, proposals and coverage |
| Learning | What have we learned and chosen? | Lessons, Loop findings, retros, proposal decisions, session trials |
| Activity | What actually happened? | Source-derived events and UI operation receipts, linked to evidence and revision |
| Settings | What is enabled, connected and allowed? | Planning source, selected guide, practices, local paths, delivery, agents/budgets, integrations, coverage |

Deep links should identify a repository and source entity, not a list position:
`/projects/:projectId/plan/:phaseId`, `/actions/:actionId`,
`/projects/:projectId/work/reviews/:pr`, `/projects/:projectId/health/incidents/:id`.
These routes are proposed, not existing APIs.

## Home: the first shipping screen

### The hierarchy

1. **Header:** Home, selected fleet, search, Refresh, and last complete/partial read.
2. **Decisions that need you:** the concrete question, options, recommendation
   with evidence, what is blocked and the consequence of deciding. Show up to
   three, then link to all decisions. An urgent production failure can lead.
3. **Ready to test:** guided walks with the real environment, exact steps,
   expected result and “This works” / “Doesn't work” / “Can't test yet”.
4. **Recently added:** visual change cards with screenshots, before/after where
   useful, what the change enables, availability and a direct “Try it” action.
   Group related commits into the user-visible change they delivered.
5. **Your projects:** consistent summaries ordered by attention by default.
   Offer name and pinned order. Filtering never hides source outages behind an
   empty result. Project context remains visible on every card above.
6. **In progress / waiting:** current agent and night work plus time-dependent
   walks. Keep them visible without asking the owner to act prematurely.

On a typical laptop, one decision and the next guided walk should be visible
without scrolling, with recent additions immediately below. At 360px, stack the
same information in this order. At 20+ projects, default to compact project rows;
the primary design for a small fleet is richer cards. These are density modes
of the same model, not different applications.

### A project summary

| Field | Example wording (illustrative) | Rule |
| --- | --- | --- |
| Identity | Acme Studio · web · local checkout | Display name plus repository; disambiguate same names and multiple checkouts |
| Current outcome | Make the publishing flow reliable | Read the active goal/outcome; if several are active, show the one associated with next work and link the others |
| Attention sentence | One walk is ready; a production read is unavailable | Deterministic facts, with no opaque overall health score |
| Human work | 1 ready walk · 2 decisions · 1 waiting | Ready and waiting counts are separate; incomplete coverage says “at least” |
| Progress | 8 of 12 built · 3 lived-in · 1 walk owed | Separate claims; no single percentage that equates implemented with accepted |
| Active work | Phase 14 claimed by a session · updated 18 min ago | A claim is not proof the agent is running; show “claimed” unless an execution source says running |
| Next | Review publishing on a phone | Prefer the highest-priority ready human ask; otherwise name free agent work or the waiting condition |
| Delivery | Gate passed at abc123 · serving def456 · verify pending | Every claim has its own revision and time; CLI/static projects can say not applicable |
| Health | 2 measures outside bounds · practice update available | Show findings separately from unavailable instruments and drift |
| Night | 1 PR opened · 1 item unfinished | A completed job is not accepted work; estimated allowance is not actual spend |
| Provenance | Local files now · GitHub 8 min ago · logs unavailable | Expand to source timestamps, revision, coverage and reason |

Limit the default card to identity, outcome, attention, next action, and two
compact context rows. Expand for full progress/delivery/night detail. A single
“Open project” link is always available; the primary action is contextual.
Use “Open walk”, “Review proposal”, “Inspect failed verify”, or “View next phase”.
Do not use “Fix everything” or an unexplained “Run agent”.

### Ranking and deduplication

Use visible categories, with stable ordering inside each category:

1. Production failures and unresolved writes needing recovery.
2. Human actions blocking current work: explicit decisions, setup and review-round limits.
3. Ready human walks and other decisions.
4. Measured regressions and overdue source deadlines.
5. Routine upkeep; free agent work; waiting observations.

Show why an item is here. Within a category use explicit due date, then waiting
age, then repository and stable source ID. A source `due` is not an `after` gate.
Project ordering takes its highest-priority item; pinning is a display preference.
Deduplicate a walk seen by the roadmap and loose-ends using project + phase +
acceptance item; group a PR's related findings under one PR. Preserve both source
links. Do not deduplicate similarly worded items across different projects.

No LLM is required to rank Home. Optional summaries later must link their
underlying records and cannot invent urgency, owners, effort or acceptance.

### Loading and imperfect data

Render local/cached summaries first, then update each source independently.
Keep the last successful value visible with its age when refresh fails. A card
may simultaneously say “CI passed 2 hours ago” and “CI refresh unavailable”.
Never replace missing data with green, zero, or “nothing to do”.

Distinguish: loading, complete, partial, stale, unavailable, not configured and
not applicable. A summary count includes its coverage. “No actions” requires a
complete relevant read; otherwise say “No known actions; 2 sources unavailable”.
Missing checkout means remote inspection is possible but local actions need a
checkout. Missing credentials names the connection, without requesting secrets
in a normal form. One failing project must not block the rest of Home.

Auto-refresh while visible using cached readers; explicit Refresh requests a
bounded fresh read. Share cache and quota accounting across project panels.
Keep the current board's 10-minute GitHub cache and quota-floor behavior as the
initial policy. Pause disruptive updates while a note is being edited; do not
reorder focused rows under the keyboard or discard a draft on refresh.

## Human walks: the signature interaction

“Walk” means a person uses or inspects a real surface and records what happened.
Keep the term, with explanatory copy on first use. Use **Walks ready for you**
on Home; a phase number alone is not a useful ask.

Open the walk in a detail drawer on desktop and a full page on mobile. Include:

- Project, phase, acceptance item, and **what you are being asked to judge**.
- Why it matters and what is already proven by automation.
- “Look here”: real environment/page, relevant commit and evidence links.
- Steps and readiness condition from Your part; time estimate only when authored.
  Each step names an action, the expected observable result, and the exact
  environment/revision. Present one step at a time with accessible step navigation.
- The phase's actual choices, with a visible explanation of each consequence.
- An observation field; a plain walk requires a meaningful observation, not a
  prefilled “Looks good”. Choice-only records remain possible where the source
  explicitly defines a sufficient choice.
- A preview of the evidence entry, checkbox change, resulting status and files.
- **Record observation** followed by an explicit result and diff.

Readiness is evaluated at action time as well as render time. A waiting walk
shows its condition and source; it cannot be completed just by advancing the
browser's clock. Several open boxes become separate steps tied to exact source
items. Preserve the existing CLI's box selection and choice validation.

**Important existing behavior:** `walk done` can set a phase to `built` when all
open boxes close; it does not set `lived-in`. Choices named in `Keeps it open`
record an answer without checking the box. The preview must show the actual
effect. Never assume every negative choice is safe to send through `walk done`:
an unmapped failure or “not enough evidence” must stay a draft until a supported
source-preserving record-only path exists. Add that path before exposing a
generic “Failed” or “Not yet” button. Do not infer success from the label.

For the local board, after a write say **Recorded locally · uncommitted**, list changed files, and
retain the result under session activity even when the item leaves the queue.
The owner can inspect the diff or continue to the next ready walk. Committing,
pushing and acceptance beyond the command's actual effect are separate actions.
The hosted [guided-walk contract](web-guided-walks.md) instead previews the exact
conditional source commit and reports success only after its verified receipt.
For read-only milestone/project plans, link to the owning source; never write an
archived local phase to make the UI look complete.

### “This works” and “Doesn't work” are equally useful

Each step offers three explicit responses, with no default success selection:

| Response | What the person supplies | What the record means |
| --- | --- | --- |
| This works | Optional detail per step, plus final device/environment and observation where required | This particular expected behavior was observed on the named revision |
| Doesn't work | What happened instead; optionally a screenshot, annotation or short recording | The failed step and reproduction are retained; the walk remains open |
| Can't test yet | Missing access, setup, environment, time or another reason | A blocked or deferred observation; never a test failure or acceptance |

Preserve answers and notes when navigating back, closing the panel or refreshing.
Show “2 of 3 steps observed; 1 failed” instead of a completion percentage that
hides a failure. A failed step may still be followed by other independent steps;
dependent steps show that their prerequisite failed. Final review lists all
steps, expected/actual results, attachments, revision and proposed record effect.
Only all required successful observations can offer an acceptance action, and
the underlying phase validator still decides whether its boxes may close.

On failure, prepare a repair brief containing the original change, environment,
step, expectation, actual result and attachments. The next action can be
**Review repair brief**; creating an issue or launching an agent is separately
chosen under the existing policy. A later fix offers a fresh walk against its
new revision, preserving the earlier failed observation. Unaffected steps may
be shown as historical context but are not silently accepted for the new build.

These step observations need a versioned authored walk record (or a compatible
extension of Your part) linked to the phase's acceptance item. Free-form phase
prose is not automatically a trustworthy test script. An agent can propose steps
from acceptance criteria; missing environment or expected behavior is an authoring
gap, not a reason to invent a runnable walk. Record-only outcomes and per-step
draft storage are new capabilities; current `walk done` alone cannot supply them.

## Decisions that need you

A decision card must be possible to understand before opening the phase:
“Should the import repair retry once or change the queue?” is useful;
“Phase 18 needs attention” is not enough.

Show the question, why it matters now, available options and their tradeoffs,
the author's recommendation and evidence, what each choice unblocks, and any
cost/resource obligation. Include “Need more information” or a source-supported
deferral where appropriate. Distinguish an agent recommendation from a settled
owner decision. Do not preselect an irreversible or spending choice.

Opening the card shows enough source context to decide. Selecting an option
previews the resulting record and side effects. After explicit submission,
retain a receipt: choice, reason, source revision, author, date and what remains.
A newly invalidated source prompts another review; it cannot reuse the old yes.
The board removes the resolved ask while the project summary shows its consequence.

Use existing `walk decide`, `learn decide`, Loop owner decisions and goodnight
approval where their semantics fit. An arbitrary architectural question needs
its owning decision record and a supported writer before getting a Save button.
There is no universal backend “approve” action today.

## Recently added: a visual change journal

Lead each card with the user-visible result: “You can now edit a published page
on mobile.” Follow with why it helps, a screenshot or short clip, current
availability and **Try it**. Link the phase, PR, implementation revision and
evidence in detail. UI changes can show before/after at the same viewport;
nonvisual work uses a concrete request/response, measured result or log excerpt
with provenance instead of an invented screenshot.

Keep availability precise: **Preview available**, **Merged; awaiting deploy**,
**Serving; human test needed**, or **Verified on the named revision**. A preview
screenshot proves only what it depicts. A changelog entry, merge or screenshot
does not complete the human walk. Link “Try it” to that revision's real surface
and the corresponding guided walk. If access expired or the environment has
moved, say so and request a fresh capture/walk instead of claiming equivalence.

Every user-facing UI change must supply relevant desktop/mobile captures, a
working preview or try link and a short “what to explore” guide, or explicitly
record why a capture or preview is unavailable. Missing material is visible in
the change package rather than silently omitted.

### Where screenshots come from

The builder's handoff should include a small change package:

```text
Change: project ID, title, user-visible result, phase/PR, implementation revision
Availability: environment, observed serving revision, URL, observedAt
Media[]: artifact ID, relative path, kind, caption, alt text, capturedAt,
         capturedRevision, environment, viewport, scenario, checksum
Walk: source acceptance item, authored steps, expected results, prerequisites
```

This is a proposed shared artifact contract, not an existing CLI flag or source
of acceptance. Generate screenshots through a real browser capture during a
builder's existing verification/handoff, or explicitly on demand. Store approved
artifacts alongside the evidence or in the project's configured artifact store;
index them by source identity and revision. The UI reads the package, handles
expired artifacts, and never recaptures every project just because Home opened.
Before/after media names both revisions and comparable scenarios. Missing media
gets a useful text card with “No capture attached”, never an AI-generated stand-in.

Use synthetic accounts or explicitly authorized data for captures. Review
potential private content before publishing outside the local workspace; media
inherits the source project's visibility. Keep remote media origins bounded and
serve only authorized artifacts. Captions, alt text and keyboard-operable enlarged
views make visual changes accessible. Attachment upload, redaction, artifact
retention and publishing permissions need explicit implementation contracts.

### Make new work discoverable without losing focus

Group the journal by project and user-visible change, with a “since last visit”
filter. First visit uses a named date range. Seen/unseen is a personal preference;
it never changes acceptance or hides a required walk. Keep new arrivals behind a
“3 new updates” control while someone is reading or testing. When a decision or
test finishes, offer the next ready item while preserving a receipt for this one.
This forms the daily loop: **see what changed → try it → report what happened →
decide what happens next**.

## Other useful journeys

### Morning: “What happened, and what needs me?”

Home highlights changed projects and the latest morning outcomes: done, tried,
failed, left alone and unfinished. Open a project to see each planned item,
its output PR, before/after measurements when available, and the human follow-up.
Reviewing the brief does not send an issue or publish a canvas card. Sending is
a named action showing destination and assignee.

### Evening: “What should happen tonight?”

A plan editor starts from goodnight's suggestions. Add/drop items, choose an
eligible lane, enter the measured target and bound, allocate minutes, and mark
paths/items to leave alone. Show configured allowance, proposed allocation,
observed usage and unknown cost separately. Explain disabled lanes and pending
robot rubric requirements. Preview the exact plan diff and any issue creation,
then **Approve tonight's plan**. Drafting is not authorization to expand a budget
or start a schedule. A date/time always includes its timezone.

### Review: “What decision is actually mine?”

Group comments by PR and review round. Link the code and preserve the three
reply types: fixed with commit, tracked with issue/version, or not valid with
reason. Read-before-answer is part of the workspace. Classification is separate
from answering. At the round limit present the owner's choices and evidence.
An unanswered comment is work, not a new universal merge gate. Initially open
GitHub for replies and merges; enable in-app replies only when the explicit
outward action and resulting receipt are implemented.

### Health: “Is the work helping?”

Plot actual dated measurements against their configured bounds with unit,
sample/window, source and coverage. Show old/new evidence without rewriting old
measurements. A proposal can be proposed, accepted, delivery uncertain, issue
created, implemented, or remeasured; accepting is not improvement. Long-file,
worktree and draft proposals expose their different consequences. Never delete
a worktree just because its proposal was accepted.

### Delivery: “What is tested, and what is serving?”

Show default branch, tested ref, requested production ref, observed serving
revision and smoke result as distinct facts. Promotion previews the commit
range, gate evidence, destination, timeout and subsequent verification. A moved
ref with failed verification is a visible partial outcome, with the supported
recovery/rollback path. Error-repair verification additionally needs a complete
window and traffic/probe evidence. Zero observed errors alone stays inconclusive.

### Learning and planning

Goals are editable outcomes with derived progress; phases have acceptance and
dependencies, not just Kanban columns. Show a compact dependency view on demand.
Loop triage presents findings, source reads, rank and proposed home together;
only the person decides. Lessons show shape, cost, guard and provenance. Retro
capture turns reviewed candidates into records; a worksheet does not apply its
own advice. Session trials are an advanced comparison view with actual costs,
unknowns and policy bounds, not a second agent execution system.

## Interaction and visual language

Use a quiet, information-dense workspace: neutral surfaces, readable titles,
subtle dividers, and color only for meaningful states. Amber means human attention,
red a failed observation, and neutral labels identify waiting or unknown states.
Pair every color with text. Do not paint an entire project red because one
instrument is unavailable. Avoid decorative charts and success percentages.

Support keyboard navigation, visible focus, semantic headings and real controls.
Drawers return focus to their originating item; Escape dismisses without losing
an unsaved observation. Announce action results through a live region. At mobile
sizes, replace wide tables with labeled rows and keep primary actions reachable.
No operation depends on hover, drag, or color. Reduced motion and system light/
dark appearance are supported. Search/filter state belongs in the URL where
shareable; personal pins and view density are preferences, never project facts.

## Technical plan and authority

### Hosted private workspace

The owner selected authenticated access across projects and separation of public
app code, private workspace records and project-owned facts. The
[workspace contract](web-workspace.md) now owns deployment, storage, identity and
authorization. Preserve the existing loopback board as a supported local entry
point and reuse its domain classification; do not expose its server publicly.
Keep zero runtime dependencies and installation from main with no build step.
Standalone browser modules/CSS and the Node runtime serve the hosted app.

### Read model

Reuse domain readers behind a proposed versioned view model:

```text
ProjectSummary
  id, repo, displayName, checkoutIdentity?, planningSource, capabilities
  goal, progress, attention[], next, activeWork[], delivery, health, night
  sources[] { kind, state, observedAt, revision?, coverage, reason?, link? }

Action
  id, projectId, kind, sourceRef, expectedSourceVersion, responsibility
  ask, why, readiness, effort?, choices[], consequence, requiredCapability
  previewOperation?, executeOperation?

WalkDraft
  projectId, sourceAcceptanceItem, sourceVersion, testedRevision, environment
  steps[] { id, action, expected, dependsOn[], outcome?, actual?, artifactRefs[] }

ChangeEntry
  projectId, sourceRefs[], implementationRevision, userVisibleResult
  availability, mediaRefs[], walkRef?, observedAt
```

These are proposed contracts. Every derived value keeps provenance; coverage is
per source, not a single global “synced” bit. Repository identity plus checkout
identity prevents a local mutation from targeting the wrong worktree. Persist
only cache, preferences, drafts and operation receipts; derive acceptance anew.
Fetch bounded summaries first and expensive histories on demand. Preserve
planning-source adapters, including the `projects` shape the CLI can read but
does not edit. Do not force every repo through the local-phase parser.

### Actions

Use an allowlisted operation registry with typed arguments, capabilities,
side effects and preview semantics. Call shared domain functions where possible;
when invoking a CLI, pass an argument array and consume JSON. A generic shell
textbox is not a product action. Existing `--json` is necessary but not a promise
that every successful process produced complete evidence.

1. Resolve project and checkout; load capability and source revision.
2. Preview concrete effects, including local files, remote destination and price.
3. Execute only the chosen action; revalidate source and authority under a
   durable per-project mutation lease with fencing across Vercel instances. A stale preview is rejected and refreshed.
4. Record success, partial completion, refusal or uncertain delivery; refresh
   affected source readers. Never blindly retry an uncertain remote write.

Ordinary local edits use a clear Save/Record action, not repeated modal approvals.
External resources, scheduled spend, publishing and destructive actions have a
specific review screen. Keep existing receipts for robot issues and canvas
recovery. A retry resumes that receipt, not a fresh issue intent. A running job
needs visible progress, elapsed time and truthful cancellation semantics; closing
the tab cannot imply that a remote operation was cancelled.

Preserve the local board's protections. The hosted service uses the separate
session/access boundary in the workspace spec, CSP, origin checks and credential
redaction in URLs/logging.
Source Markdown and remote titles are untrusted content and are rendered safely.
Capabilities come from backend policy, not hidden buttons. Preview/apply and
diff transactions are new work for commands that do not currently support them.

## Delivery sequence and proof

The first delivery plan is [workspace phases 93–101](web-workspace.md#phases-and-release-criteria),
under goal G7. Phase 93 enforces private storage, 94 connects owner-approved
resources, 95 authenticates, and 96 ships the first useful read-only Home.
Decision and guided-walk implementations in 97–98 have local proof; their hosted
migrations and real-owner writes remain separate acceptance. Visual changes
follow in 99; daily work and learning follow in 100, with live acceptance and
restore in 101. Do not wait
for a graphical version of every CLI flag. Link-outs are staged delivery, not the
end state for core operations. [Fleet phases 102–108](web-fleet-operations.md)
add run history, connections/capacity, workers, fleet rollouts, routing, operation
coverage and the full mobile/desktop operating trial.

Integration verification should cover data contracts, source gaps, routing,
concurrent/stale actions, receipts, accessibility and responsive behavior.
Use the existing hermetic setup and synthetic Acme fixtures. The eventual
integrated change runs `npm run check` and `npm run typecheck`; a mockup is not
that proof. Human acceptance requires real use: open Home without CLI context,
choose the right project/action, complete a walk, find the resulting evidence,
and recognize an unavailable source without mistaking it for healthy.

Measure usefulness during the walk: time to identify the next human action,
time to find its evidence, unnecessary terminal detours, mistaken-completion
incidents, and which information the owner repeatedly expands. Record a baseline
and observations; do not manufacture performance or usability results.

## Deliberately open

- **Settled 21 October 2026 — hosting and ownership:** the owner requested
  authenticated remote access with app code in public Plates, shared records in a
  private workspace and project facts in each project. The workspace spec
  replaces the earlier local-first delivery recommendation. Vercel and Supabase Free are now selected and provisioned; the approved
  read-only GitHub App is installed and live login/access checks pass. Expanded worker/provider
  permissions remain explicit setup choices.
- **Agent launch integration:** initial “View next work” can expose a prepared
  brief/command. Launching a particular host requires a supported host adapter,
  existing authorization and budget; a claim is not a launch API.
- **Arbitrary negative walk results:** requires a record-only domain operation
  where existing source choices do not already keep the walk open.
- **Commit/push workflow:** begin with honest local diff receipts. Choose an
  explicit integration path before adding a convenient “save everything” control.
- **Notifications and collaboration:** start with existing morning delivery.
  Assignment, shared snoozes and new notifications require explicit semantics;
  they must not become hidden acceptance state.

This proposal extends the existing board and canvas directions. It does not
supersede their guarantees, rewrite historical evidence, or claim completion of
the fleet's outstanding real-project walks.
