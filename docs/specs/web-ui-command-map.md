# Keel CLI → web UX inventory

Companion to [the web UI proposal](web-ui.md). Audited 20 October 2026 at
`d60ea553f51d9a0ee8558b706de8f7526e28777c`. Scope: every registered public
`keel` verb, its positional arguments and options, global dispatch flags, and
the user-facing installed-practice surfaces that deserve a place in the UX.
Internal workflow/script flags are not additional public `keel` commands.

Sources: [`lib/cli.mjs`](../../lib/cli.mjs),
[`lib/agent-guide.md`](../../lib/agent-guide.md), and forwarded parsers in
[`canvas`](../../lib/canvas.mjs), [`goodnight`](../../lib/goodnight.mjs),
[`session trials`](../../lib/session-trials.mjs),
[`production wrapper`](../../lib/production.mjs),
[`production runtime`](../../practices/night/files/scripts/keel/production.mjs),
[`promote`](../../practices/delivery/files/scripts/keel/promote.mjs), and
[`persona`](../../practices/personas/files/scripts/keel/persona.mjs).

All treatments below are proposed. “First” means Home/first human workflow;
“Later” means a useful subsequent workspace; “Advanced” means inspect/copy/open
the CLI initially. A command's availability never implies it is safe to execute
while rendering a page. Some nominal reads fetch refs, update caches or write
reports. Only explicitly selected operations may write project records.

## Current source audit, 22 October 2026

Phase107 reaudits the dispatcher and forwarded/installed parsers at source base
`09eec5ef1ec54dc5a6d6a6340558906e993aac49`: 46 registered entries, 88 forms/modes,
359 explicit argument rows and 22 direct entrypoints among 46 shipped scripts.
These are dated census counts, not proof of executed web operations. The
[operation experience](web-operation-experience.md) owns the new shared registry,
reviewed source-boundary drift check, scoped capability catalogue and honest
activation states. Its implementation is tracked in
[phase107](../phases/107-mobile-and-desktop-cover-keel-operations.md).

The earlier tables below retain their historical proposal status. They are not
current availability labels. The live catalogue separates native subsets,
supported workers, presentation-only arguments and limitations with follow-up;
source grants, configured enablement and fresh domain verification remain separate.
A parser-source change demands review even when help text is unchanged. Canonical
package coverage cannot establish the grammar of an adopter-modified script or a
project-configured command. Required failed-night retry remains an implementation
gap; neither CLI copy text nor the typecheck worker closes that journey.

## Inventory update, 21 October 2026

The original audit below remains dated to its source revision. Rechecked the
registry at `eeb0dbb` (44 verbs) for the new public surfaces; these supplement that audit.
Phase 93 adds workspace setup as a separate command, not a board flag.

| Command | Every argument / option beyond `--json` | UX and boundary |
| --- | --- | --- |
| `feedback capture` | `<file>`, paired `--yes --digest <sha256>` | Local private result capture with immutable version and exact preview approval. Web capture remains phase 98 work. |
| `feedback list` | No further arguments | Metadata and explicit coverage; no private words in ordinary Home/canvas exports. |
| `feedback propose` | `<id>`, required `--record <publication-file>` | Exact excerpt/destination and existing issue handoff preview; never posts or starts work. |
| `feedback resolve` | `<id>`, required `--record <resolution-file>`, paired `--yes --digest <sha256>` | Reviewed local linked/declined/superseded outcome; does not establish acceptance. |
| `decision context` | Exactly one of `--phase <id>`, `--issue <owner/repo#n>` | Decision context drawer; keep accepted decisions, proposals and gaps separate; source digest prevents stale submission. |
| `shape check` / `shape render` | `<file>` | Validate or inspect structured planning answers; owner attribution is evidence, not authentication. |
| `shape plan` | `<file>`, `--output <new-directory>`, `--yes`, `--digest <reviewed-digest>` | Preview generated planning artifacts and exact digest; approve to write only into a new destination. |
| `workspace inspect` | `--manifest <absolute-file>`, `--state <absolute-dir>` | Setup diagnostics, identity and unverified remote privacy; never writes. |
| `workspace init` | Same paths, `--yes` | Exact external directory/identity preview then idempotent private initialization; does not create a GitHub repo or grant access. |

The phase 93 workspace entries are a build contract until that phase's evidence
exists. Provider/hosting parameters are not invented CLI flags. The existing
public verbs plus these additions retain JSON transport and documented help.

## Expanded operating goal, 21 October 2026

[Fleet operations](web-fleet-operations.md) expands the final target to mobile/desktop
control of every authorized project. “Advanced” and initial CLI/link-outs below
are delivery stages, not permanent exclusions for core operating journeys. Phase
107 must re-audit the live registry and every argument against native workflows,
supported workers/local bridges, presentation-only options or explicit limitations
with follow-up. Local filesystem arguments become scoped worker inputs, not raw
server paths. Secret setup is now a dedicated scoped connection workflow, never
a generic environment editor. Routine history, worker dispatch, provider capacity
and routing policies are new shared domain capabilities; do not invent CLI flags
for them or mistake GitHub quota for model quota.

## Shared controls and arguments

| Argument / convention | UX treatment |
| --- | --- |
| `--json` (every public verb) | Backend transport, not a checkbox. Preserve structured result, domain state, exit code, source gaps and stderr separately. |
| `--yes` where accepted | The submitted, concrete action after its effect is shown. Never a persistent “approve everything” setting. Many commands do not take this flag. |
| `--dry-run` where accepted | Preview/rehearsal mode, showing destination and scope. A preview is not evidence of completion. |
| `--fresh` where accepted | Explicit Refresh with source age, quota and partial results. Normal rendering shares cached reads. |
| IDs, slugs, phase numbers, refs and paths | Select a source object with readable title plus stable ID. Show exact revision/path in detail. Backend resolves within the chosen project; no ambient working-directory ambiguity. |
| Repeatable flags | Multi-selects or repeatable form rows; retain each value and order where meaningful. |
| `--note`, `--reason`, `--read` | Authored observation, rationale or source citation as appropriate; never fabricate these from a button click. |
| Time/date/window arguments | Labeled units and explicit timezone; show source timestamp separately from last UI refresh. |
| Exit codes | Interpret by command. 0 may contain gaps; 1 may mean a finding, 2 a broken instrument/usage, 3 a preview/owner decision. Never show a universal “failed” toast solely from a nonzero exit. |

## Home, planning and coordination

| Command | Every argument / option beyond `--json` | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `status` | `--project <p>` | Project summaries and goal progress. The selector is a subproject for the projects-shaped source, not a fleet repo selector. | First |
| `next` | `--project <p>` | Next action plus free/claimed work. Preserve fetching/claim-read errors; never assign work from an unread claim set. | First |
| `goal list` | None | Goals with derived built/lived-in/walk counts. | First read |
| `goal show` | `<id>` | Goal detail with outcome and constituent phases. | First read |
| `goal add` | `<title>`, `--outcome <sentence>` | New outcome form. Preview local goal/roadmap changes before save. | Later |
| `goal retire` | `<id>`, `--reason`, `--phases supersede\|move:<Gm>`, `--yes` | Retirement review listing every affected phase; choose destination or supersede. | Later |
| `phase list` | None | Plan list with status, dependency, human work and evidence. Preserve planning-source limitations. | First read |
| `phase new` | `<title>`, `--goal <id>`, `--depends <comma-list>` | Phase composer starts with outcome/proof, goal and dependency picker. CLI scaffolds; UI must distinguish draft spec from acceptance-ready plan. | Later |
| `phase claim` | `<n>`, `--provider <name>`, `--token <t>`, `--release` | Ownership panel, claim/release action, provider label. Token is an ownership mechanism, handled by backend; never a normal editable credential or logged value. No releasing another session's claim. | Later |
| `ready` | `--branch <name>`, repeatable `--check <cmd>` | Handoff summary: branch, explicit fast checks and their results, then push/ready receipt. Commands come from configured/validated choices; no arbitrary shell runner. | Advanced |
| `integrate` | None | Integration operation with shared lock, included branches, one full gate, failed-change result and push receipt. Cannot become an auto-refresh call. | Advanced |
| `board` | `--open`, `--port <n>`, `--fresh` | Existing app entry point. Open/port are local launcher preferences; fresh is Refresh. Retain JSON compatibility as the app expands. | First |
| `walk done` | `<phase>`, `--note`, `--choice <authored choice>`, `--box <n>` | Authored guided steps, explicit private outcomes/history, readiness and actual environment, final observation, exact phase/evidence/roadmap preview and original receipt recovery. One exact acceptance-text hash; no bulk acceptance. See [guided walks](../guide/web-walks.md). | Implemented locally; hosted owner-write proof pending |
| `walk decide` | `--proposal <page>`, `--instance <id>`, `--accept [why]` or `--decline <why>` or `--map <file>` | Proposal review with stable instance, source freshness and consequence. Structured mapping gets a validated editor for time proposals; ordinary decisions, mapped time proposals and robot issue delivery retain different effects. | First ordinary decisions; Later delivery |
| `loose-ends` | `--all`, `--phase N`, `--root <dir>`, `--fresh` | Unfinished work inbox: all/current, phase filter, explicit checkout scope and refresh. Root is server-resolved, not a browser-supplied filesystem authority. | First read |
| `loose-ends mark` | `<id>`, `resume\|park\|drop`, `--reason`, `--until YYYY-MM-DD` | Resume, defer until date, or dismiss with rationale. Explain that dropping tracking does not delete a branch, worktree or PR. | Later |

Local goal/phase writes are disabled for externally owned milestone plans and
unsupported local variants. Projects-shaped plans get their supported readers,
not fabricated local editing. Preserve `due`, `after`, readiness and dependency
semantics as different things.

## Reviews, issues and delivery

| Command | Every argument / option beyond `--json` | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `review` (read) | `<owner/repo>#<n>` or `<owner/repo>@<sha>`, `--wait`, `--gate`, repeatable `--reviewer <login>` | Review workspace scoped to PR/commit and reviewers, round history and waiting status. Gate mode is advanced policy inspection, not a universal “block merges” toggle. | First links/read; Later workspace |
| `review` (answer) | `--close <id[,id…]>`, exactly one of `--fixed <commit>`, `--tracked <issue\|version>`, `--not-valid <why>`; optional `--class <kind>` | Read each comment, inspect evidence, compose and explicitly post its reply. Though the parser accepts multiple IDs, do not offer indiscriminate bulk dismissal. | Later |
| `review` (classify) | `--class security\|overwrite\|approval\|other <id[,id…]>` | Classification is a separate action that leaves the comment unanswered. | Later |
| `review` (file tracked work) | `--close <id> --tracked --file-agent-issue --title <title> --rubric <file> [--yes]` | Preview reviewed rubric, repo, issue and eventual reply; recover uncertain creation before retry. | Later |
| `issue new` | `--agent`, `--title <title>`, `--rubric <file>`, `--yes` | Guided repair spec: problem, reproduction, acceptance and bounded change; show eligibility and allowance before creation. Robot OFF produces an unlabelled issue, not a running task. | Later |
| `drain` | `<prefix>`, `--gate-passed`, `--yes` | Queue inspection plus exact merge/close plan. Gate-passed must be established by evidence, never a user-controlled “trust me” checkbox. | Advanced |
| `promote` | Optional `<commit>`, `--yes`, `--within <seconds>`, `--every <seconds>` | Review tested commit, range, gate, target ref and verification timing; execute as a tracked operation. | Later |
| `promote --back` | `<commit>` after `--back`, `--yes`, `--within`, `--every` | Separate rollback flow with exact serving-revision verification and honest failure result. | Later |

The UI does not invent a generic `keel merge`, `keel deploy`, or `keel agent run`.
Use GitHub or a supported existing operation for those responsibilities.

## Night, morning and measured health

| Command | Every argument / option beyond `--json` | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `night plan` | `--date YYYY-MM-DD` | Generate the default plan explicitly; this writes a local plan, so Home reads existing records rather than invoking it on render. | Later |
| `night tick` | `<id>`, `--status planned\|running\|done\|failed\|skipped\|left-alone`, `--note`, `--link` | Item timeline; transitions normally come from runners. Manual correction is advanced and uses the validator, never a drag-to-done shortcut. | Advanced |
| `goodnight` | No subcommand | Evening worksheet: settled/open/default/suggested. | First read |
| `goodnight add` | `<suggestion-id>` or `--title`; `--kind`, `--measure`, `--bound <number>`, `--better lower\|higher`, `--lane`, `--budget <minutes>`, `--id` | Suggestion picker or structured item editor; target, direction, lane and minutes in plain labels. ID is generated/stable, editable only in advanced details. | Later |
| `goodnight drop` | `<id>` | Remove from draft with immediate visible plan change. | Later |
| `goodnight edit` | `<id>`, `--title`, `--kind`, `--lane`, `--measure`, `--bound`, `--better`, `--budget` | Edit the same typed fields in place; preserve valid lane/measure combinations. | Later |
| `goodnight budget` | `<id> <minutes>` | Per-item allocation against configured ceiling. | Later |
| `goodnight skip` | `<path-or-id>` | “Will not touch” list with exact scope. | Later |
| `goodnight --yes` | `--yes` on its own command, not on a draft edit | Review and publish the completed plan; show any robot issue creation and remote branch. | Later |
| `morning` | `--date YYYY-MM-DD` | Read a past/current brief; distinguish unfinished from completed. | First read |
| `morning --send` | `--send`, optional `--date` | Explicitly send assigned GitHub issue, with destination/recipient and deduplication. No send on page load. | Later |
| `morning --card` | `--card`, `--dry-run` or `--yes`, optional `--date` | Preview/publish the live canvas card separately from sending the brief. | Later |
| `improve` | `--report`, `--transcripts <dir>`, `--selftest`, or `--sessions` | Health read; Save report is explicit; transcript directory is a local advanced source; selftest is diagnostics. Sessions is its own audit mode and cannot be combined with other options. | First saved summaries; Later runs |
| `persona run` | `<name>` or `--all` | Persona goals with met/missed/broken results; Run writes review records and may execute configured measurements. | Later |
| `time` | `--weeks N` | Window picker for gate/test medians, load and failure memory; retain units, coverage and history limitations. | Later |
| `test` | One or more `<file>`, required `--stalls`, `--name <pattern>`, `--seed N` | Advanced diagnostic run builder with exact scope/seed and baseline-versus-stalled result. | Advanced |
| `evidence rederive` | `<phase>`, `--yes` | Inspect measurement commands/bounds, then explicitly rerun and compare old/new. Preserve historical evidence. | Later |
| `prove` | `<test file>`, `--name <pattern>`, `--fix <path>...`, `--base <ref>`, `--mutate`, `--trailer`, `--evidence <phase>` | Evidence workspace: test and changed files, baseline, mutation mode; three outcomes VERIFIED/NOT WORKING/INCONCLUSIVE. Copy trailer or explicitly attach evidence. Milestone sources cannot receive local phase evidence writes. | Advanced |

## Production observations

| Command | Arguments and controls | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `production status` | No additional input normally; `--recover --yes` for recovery (without yes previews) | Incidents, source coverage and recovery status. Recovery is a separate operation. | First summary; Later detail |
| `production collect` | `--source <id>`, `--start <UTC>`, `--end <UTC>`, `--yes` | Bounded collection preview with source/window and limits, then persist observations. | Later |
| `production spec` | `--incident <id>`; `--rubric <file>` and `--yes` for issue delivery | Inspect proposed repair, then review an authored rubric before issue creation. Spec generation is not proof of reproduction. | Later |
| `production verify` | `--incident <id>`, `--revision <sha>`, `--probe <path>`, `--yes` | Evidence checklist: serving revision, smokes, complete window, traffic/equivalent probe and recurrence. Inconclusive remains visible. | Later |

The shared runtime parser also accepts `--source`, `--start`, `--end`,
`--incident`, `--revision`, `--probe`, `--recover`, and `--yes` across its forms;
that is not a reason to expose irrelevant fields on every screen. The issue
wrapper for `spec --rubric` deliberately accepts only incident/rubric/yes/json.
Validate the operation-specific contract rather than constructing forms by
blindly combining the usage line's flags.

## Practices, onboarding and the fleet

| Command | Every argument / option beyond `--json` | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `fleet` | None | Home project inventory and version/health/CI summaries, on the mothership. | First |
| `fleet update` | `--rehearse` or `--yes` | Fleet update plan with per-project rehearsal, gate outcome and resulting PRs. Rehearsal pushes nothing; actual writes are separately reviewed. | Later |
| `init` | `[dir]`, `--description`, `--name`, `--tagline`, `--kind static\|node\|web\|other`, `--repo owner/name`, `--guide <path>`, repeatable `--with <practice>`, `--github`, `--yes` | New project wizard: explicit empty directory, identity, description, type, guide and practice choices. Show local initial commit separately from optional GitHub repo creation. | Later |
| `adopt` | `[dir]`, `--dry-run`, `--guide`, `--check <command>`, `--setup <command>`, repeatable `--env KEY=VALUE`, repeatable `--with <practice>` | Import wizard previews detected practices, local variants, selected guide and project gate. Commands/environment are advanced local config; secrets do not belong in config env. Preserve project prose and symlinks. | Later |
| `doctor` | `--github`; `--fix <path> restore\|eject`, `--yes` | Findings with exact file/block diff and record contradictions. Restore/eject are explicit distinct actions; no global “repair” button. | First read; Later fix |
| `render` | `--check`, `--into <dir>` | Practice preview/check in settings; render is a deliberate local write. Destination uses authorized project selection. | Advanced |
| `update` | `[dir]`, `--local`, `--yes`, `--no-self-update` | Preview migration, managed changes and check. Choose local diff or reviewed PR; local and yes conflict. Self-update suppression is advanced troubleshooting, not the default. | Later |
| `release` | Optional `<x.y.z>`, `--notes <file\|->`, `--practice <x.y.z>`, `--unreviewed <why>`, repeatable `--despite <repo> <why>`, `--dry-run` | Mothership release workspace: CLI/practice versions, notes editor (stdin becomes content), review gate and fleet rehearsal. Exceptions require specific owner reasons. Initially CLI-only execution. It creates a local tag; do not claim it published a release. **No `--yes`: the parser rejects it.** | Advanced |

## Lessons and learning

| Command | Every argument / option beyond `--json` | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `lessons` | `--dry-run`, `--yes`, `--to owner/repo`, `--since <ref>` | Review outgoing lesson/drift/practice-commit bundle, range and destination privacy before sending. | Later |
| `learn` | No subcommand | Gather inbox/source changes; local record writing means explicit refresh operation, not incidental Home rendering. | Later |
| `learn propose` | `<slug\|issue#>`, `--outcome lesson\|practice\|decline\|link`, `--note`, `--read`, `--link <n>`, `--yes` | Evidence-backed proposal form; show outward destination and linked lesson. Agent proposes; person decides. | Later |
| `learn decide` | `<slug\|issue#> accepted\|declined`, `--note`, `--shape`, `--cost`, `--guard`, `--yes` | Review shape/cost/guard and consequence; explicit acceptance is not a whole-fleet release. | Later |
| `learn render` | `--check` | Derived inbox check/render, tucked into diagnostics. | Advanced |
| `learn distill` | No further arguments | Pattern worksheet: candidate families and unguarded/redundant shapes. | Later read |
| `learn distill propose` | `--kind family\|reword\|tag\|standardise`, `--name`, `--rule`, `--guard`, `--rows`, `--row`, `--shape`, `--cost`, `--where`, `--evidence`, `--family`, `--check`, `--practice`, `--note`, `--read`, boolean `--migration` | Kind-specific editor: name/rule/guard/rows define a family; row/shape/cost/where/evidence reword a lesson; family tags selected rows; check/practice/migration describe standardisation. Show citation and proposed diff; only applicable fields enabled. | Later |
| `retro` | `--worksheet`, `--since <commit>`, `--session <id>` | Session/range selector and seven-area worksheet; counts and sanitized pointers, not raw transcript disclosure. | Later |
| `retro capture` | `--record <file>`, `--since <commit>`, `--session <id>`, `--yes` | Reviewed record editor with source range; preview then save. | Later |
| `retro sessions status` | `--experiment <id>`, shared `--record <file>` / `--yes` parser | Read experiment state and effective policy; no mutation controls needed for status. | Advanced |
| `retro sessions start` | `--experiment <id>` where applicable, `--record <file>`, `--yes` | Validated experiment envelope, budget and policy review. | Advanced |
| `retro sessions begin` | `--experiment`, `--record`, `--yes` | Reserve run before work and show returned policy; not an agent launch. | Advanced |
| `retro sessions finish` | `--experiment`, `--record`, `--yes` | Actual builder/reviewer/handoff costs and verified outcome; unknown remains unknown. | Advanced |
| `retro sessions handoff` | `--experiment`, `--record`, `--yes` | Inspect owner decisions, revision, dirty files, jobs and next action; resume revalidates ownership. | Advanced |
| `retro sessions audit` | `--experiment`; shared `--record` / `--yes` parser | Compare evidence and complete costs inside the configured envelope; read only. | Advanced |
| `retro sessions apply` | `--experiment`, shared `--record`, `--yes` | Review evidence-backed policy transition, not freeform tuning. | Advanced |
| `retro sessions rollback` | `--experiment`, shared `--record`, `--yes` | Restore the supported policy with evidence retained. | Advanced |

The session parser shares three options across all eight actions; domain
validation determines which record is needed. A future form should derive that
schema from the actual action, not suggest that `--record` is required everywhere.

## Canvas publication

| Command | Every argument / option beyond `--json` | Useful UX and boundary | Priority |
| --- | --- | --- | --- |
| `canvas snapshot` | `--output <file>`, `--github`, repeatable `--artifact <repo-relative-json>`, repeatable `--history <repo-relative-json>`, `--window-days N` | Local snapshot source/window picker; provenance and gaps retained. | Later |
| `canvas render` | `--snapshot <file>`, `--output <dir>` | Preview/export an existing snapshot to an explicit destination. | Later |
| `canvas connect` (new) | `--create`, `--title`, `--space <id>`, `--home <origin>`, `--audience owner-only`, `--yes` | Choose exact private destination and preview resource creation. | Later |
| `canvas connect` (existing) | `--canvas <address>`, `--audience owner-only`, optional `--home`, `--yes` | Connect existing destination and show owner/audience. | Later |
| `canvas sync` | `--snapshot <file>` or `--github`; `--dry-run` or `--yes` | Publication diff, source selection, target and recovery receipt. | Later |
| `canvas status` | None | Integration status and unfinished recovery. | First summary |
| `canvas live` | Repeatable `--card <key>`, `--keep N` or `--no-keep`, `--off`, `--yes` | Live-card selection and retention; respect incompatible off/card/keep choices. | Advanced |
| `canvas rebase` | `--card <key>`, `--onto <version-id>`, `--yes` | Conflict comparison and explicit human decision. Apply needs the current version shown by preview; no automatic rebase after refusal. | Advanced |
| `canvas disconnect` | `--yes` | Explicit connection removal with effects shown. | Later |
| `canvas night` | `--report <file>`, `--yes` | Publish a specific report, usually workflow-facing. | Advanced |

## Help and global dispatch

| Command / flag | Arguments | UX treatment |
| --- | --- | --- |
| `help` | `--json` | Searchable command reference in Help and “Equivalent CLI” in action details. |
| No verb, `--help`, `-h` | `--json` supported | Entry-point aliases for help, not new navigation items. |
| `--agent-help` | Optional `<topic\|all>`, `--json` | Contextual task guide; keep operational detail out of primary product copy. |
| `--version` | `--json` | About: CLI version, commit, practice version and capability compatibility. |

## Installed-practice surfaces outside the public verb registry

These matter to a rich UX even though typing `keel loop` or `keel climb` is not
supported. Their complete internal script surface is not the public CLI audit;
user-facing operations described by agent-help are mapped here to prevent the
product from overlooking them.

| Surface | Relevant arguments / operations | UX decision |
| --- | --- | --- |
| `node scripts/loop.mjs` | `pull` (`--no-prove`), `list --json` (`-d <decision>`), `propose <slug> --rank now\|next\|later\|never --phase <n\|new>` or `--project <name\|new>`, optional `--lesson`, `--note`, `--read`; `decide <slug> <decision>`; `push` (`--dry-run`, `--yes`), `mine --yes`, `render --check`, `prove [slug]` | Learning workspace: evidence, ranking, home and owner decision. Pull/prove may spend under configured policy; no automatic model call on opening a finding. Milestones disable local phase-homing. |
| `node scripts/keel/climb.mjs` | `config`; `pick --date --force --plan`; `measure <job> --runs --baseline`; `compare --base --candidate --rounds --decide --final`; `prove-steady --test --runs --decide`; `guard --base --job`; `harmless --path --why`; `distill [propose …]`; `loop-pull`; `revert --why`; `settle`; `report --body --state --issue`; `agent-ran --agent --outcome --file --minutes --started`; `sandbox --plan` | Show measured attempts, margin, budget, kept/reverted result and PR. Leave low-level mutation, worktree, sandbox and report plumbing to the runner. Never turn compare/decide into a casual chart control. |
| Tend via climb | `tend-pick`, `tend-input --record`, `tend-note --finding --propose\|--tried`, `guard --job tend`, `tend-report --body` | Night work detail with source findings, tried/proposed outcomes and PR. Show its restriction against silently accepting phases/evidence. |
| Delivery scripts | `publish --plan` and workflow `--trigger` / `--advance --from --to`; `verify <sha> --within --every --record --json`, `verify live <sha>`, preview `--site`, exact revision checks | Visualize tested-ref selection and verification. Publishing remains the guarded workflow; previews never clear a production failure. |
| Robot, ledger, roadmap and workflow plumbing | Existing configured jobs, rubric, allowances, test ledger, generated roadmap, production recovery | Read their evidence through existing readers. No duplicate scheduler, raw workflow editor, generated-roadmap editor or arbitrary command console. Scoped write-only provider credential setup belongs to phase 103, not workflow plumbing. |

## Audit method and implementation follow-up

The owner's follow-up emphasizes decisions, step-by-step human tests and recent
additions with screenshots. The proposed step draft, record-only failed/blocked
observation, visual change package and artifact capture are **new domain
capabilities**, not existing CLI flags. Their contracts are in the
[UI proposal](web-ui.md). Preserve CLI parity when implementing them; do not
route a failed test through `walk done` merely because that verb already exists.

The inventory was checked against the exported `verbs` registry (42 entries),
the global dispatch, and the forwarded argument parsers above. Subcommands such
as canvas and retro are expanded here even where registered under one verb.
The registry is inspectable without executing any of the operations:

```sh
node bin/keel.mjs help --json
node bin/keel.mjs --agent-help all --json
node --input-type=module -e 'import {verbs,FLAGS} from "./lib/cli.mjs"; console.log(JSON.stringify({verbs:[...verbs].map(([name,v])=>({name,usage:v.usage})),flags:FLAGS},null,2))'
```

At implementation time, formalize a capability/argument registry shared by CLI
and UI, including side effects, repeatability, exclusivity and preview support.
Do not infer it with a regex over source: comments contain flags of child tools
(`ready` mentions `--test`), and explicitly rejected options (`release --yes`)
are not supported controls. Add a coverage check that every public operation
has a deliberate UI treatment: native, linked, advanced or unsupported with a
reason. This document is a dated inventory, not a second authoritative CLI spec.
