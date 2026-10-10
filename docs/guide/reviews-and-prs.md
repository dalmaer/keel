# Reviews and PRs

## When you'd reach for this

- A PR from keel has arrived (an update, a night page, a climb or tend
  pass) and you want to judge it in a minute.
- You are an agent, or a person, about to merge a PR that a reviewer (a
  person, or a bot such as Codex) has commented on.
- You are writing a script that opens PRs in a keel project and want its
  bodies to read like keel's.

## What it does, and why it works that way

### Every PR keel opens has three sections

A PR asks a person for a minute. Its body is built so that minute is
enough, by one script, `scripts/keel/pr-body.mjs`, from structured input
and with no model, in this order:

- **Summary: a picture, never a paragraph.** A file tree of the changed
  paths, or a before-and-after table. Prose makes the reader work out what
  changed; a tree shows it.
- **Evidence: before and after.** The gate's result line, and rows of
  numbers where there are any (a climb's timings, a tend pass's record
  count). When there is none it says `Evidence: none recorded.`; the
  section is never dropped, because a missing section reads as "nothing to
  worry about".
- **Merge danger: which kind of door.** A **two-way door** is one a revert
  undoes completely: a re-render of keel's files, a health page. A
  **one-way door** is one where something leaves the repo or rewrites what
  the project owns: a migration that edits the project's own files, a
  release. The blast radius is named in the phase spec's Real surfaces
  terms ("this repo only", "every adopted project", "the fleet over time").

Notes follow, and with reconciliation on, a `keel-impact` block comes last,
naming the phases and decisions the change affects. **A merge never ticks
acceptance**: merged, production-verified and lived-in are different
claims, and the PR says which records it touched rather than letting the
merge stand in for them.

Every path that opens a PR uses this script: `keel update` and
`keel fleet update`, the night, climb and tend.

### Every review comment is validated, then answered

On 6 October keel's update PRs merged on green CI with 13 Codex comments
nobody had read. They held 10 distinct findings, every one valid, one of
them serious. They were fixed in the next release only because the owner
asked whether the comments had been seen. The shape is the family keel
calls *a failure nobody is told about in time*: the reviewer spoke, and
nobody was listening.

The owner's rule: **reviews are not a gate, but none goes unread or
unanswered.** Whoever opens or merges a PR (the conductor, fleet update's
PRs, climb and tend PRs, a person) reads every comment once its reviewer has
posted, **validates it against the code first**, then answers it in one of
three forms:

- **Fixed**: the reply names the commit or release, and the thread is
  resolved.
- **Tracked**: the reply names the issue or the version it will land in.
  The thread stays open until the fix lands, then is closed as fixed.
- **Not valid**: the reply says why, citing the code, and the thread is
  resolved with it.

Validation comes first because a reviewer can be wrong, and agreeing with
every comment is as unread as ignoring them. Nothing is resolved without a
reply saying which form it is.

`keel review` makes the reading deterministic. It reads every review thread,
every review's top-level body, and each named reviewer's conversation
comments, and says which are answered. A thread is answered when someone
other than its reviewer replied after the reviewer's newest comment:
resolving a thread is not an answer, and a reviewer's follow-up reopens it.
A review body or conversation comment is answered by a later comment from
someone else that quotes a line of it (`> `), links it, or names its id; an
unrelated comment that happens to come later is not an answer
(`--close` quotes and links it for you). A top-level comment or review body
that opens with a hidden `<!-- … -->` marker (a status board the bot edits
in place) is listed as **status** and owes no answer. A read GitHub could
not complete (a list longer than one page) is never reported as clean:
`keel review` exits 2, and the night's count is n/a.

**By default nothing waits and nothing blocks a merge.** Fleet update and
the drain merge as before; the night counts what is left as
`reviews_unanswered` (comments with no answer, older than a day, on open
and recently merged PRs), and `keel loose-ends` lists them. The one
exception is opted in per phase: front matter `review: wait`, or the
phase's issue labelled `keel:wait-for-review`. Such a phase lands through a
PR, and merges only when `keel review <repo>#<n> --gate` exits 0: every
comment answered, and each named reviewer has reviewed the head commit.

### Claude reviews what Codex writes (optional)

Codex reviews every PR, Claude Code's included, and on 6 October its
reviews of keel's update PRs found 27 comments, all valid. Codex's own PRs
had no second reader. The optional `cross-review` practice adds one: a
second model catches what the author's model is blind to, and the same
model reviewing its own work does not.

**How it works.** `keel-cross-review.yml` runs an agent (Claude by
default, or Codex: see *Choosing the agent*) on a PR whose head branch starts with a
configured prefix (Codex opens PRs under the owner's account, so the
branch, not the author, says who wrote it), in this repo, never a fork. It
runs when the PR is opened or marked ready for review, and again when a
person with write access comments `/review`; never on a push, because a
review per push costs more than it tells. The brief
(`.agents/cross-review/REVIEW.md`) asks for findings only where the code
shows them: each validated against the code before it is written, tagged
P1 (wrong or unsafe), P2 (a bug in some case) or P3 (worth a look), on
the line it is about. No style nits. The agent can read the code and the
diff, nothing else: it holds no tool that comments, and never pushes,
approves, requests changes or merges. Its last message is a summary and a
JSON block of findings; the workflow checks each finding against the diff
and posts one comment review: the summary, opened by a hidden marker so it
owes no answer, with the valid findings as inline comments (a finding it
drops is named in the summary). The agent and the post are two jobs: the
agent's token only reads (Claude's action is handed it, so no app token
that writes is ever minted), and the job that posts runs no agent and
nothing from the PR's branch, only the default branch's script on the
agent's final message. The inline comments are owed answers: the
author answers each one fixed, tracked or not valid, as above.

**Switching it on.** Add `cross-review` to `.keel/keel.json` `practices`
(or `keel init`/`keel adopt` with `--with cross-review`), and the config:

```json
"crossReview": { "for": ["codex/"], "budget": { "minutes": 15 } }
```

Set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
`ANTHROPIC_API_KEY` as a repo secret. Without a secret the run ends green
with a notice; without the `crossReview` key nothing is reviewed. The
review is posted by the workflow itself (`github-actions[bot]`).

**Choosing the agent.** The reviewer is another provider than the one
that wrote the PR: Claude reviews Codex's `codex/` PRs, Codex reviews
Claude's `claude/` PRs. List every provider you use, and each PR goes to
the first one listed that did not write it and has its secret set. Only
when none is available does the author's own provider review it, with a
notice and a line in the review saying so:

```json
"agents": { "claude": {}, "codex": {} },
"crossReview": { "for": ["codex/", "claude/"], "budget": { "minutes": 15 } }
```

With no `"agents"`, Claude alone is listed, and `"for": ["codex/"]` is
reviewed by Claude exactly as before; `"for": ["claude/"]` is reviewed by
Claude too, as its own provider, until you list codex. `"agent"` on
`crossReview` is only for a prefix no provider's branch names. Codex (`openai/codex-action`)
reviews in its read-only sandbox, with sudo dropped so its key is out of
its reach, and no GitHub token; its secret is `OPENAI_API_KEY`. Codex's
spend has no subscription path: every review is billed per token to the
OpenAI API account, so the Budget line's minutes are a bound on dollars you
pay by the token. codex-action runs only for an actor with write access or
a bot it names: keel names the providers' bots (`claude[bot]`, in Codex's
and Claude's steps alike), so a PR Claude's app opened is reviewed. A `for`
prefix must name a provider's branch exactly (`claude/`) or none
(`custom/`): `"claude"` alone, which also matches `claude-fix`, is red. A provider keel does not know (a typo
in `"agents"`) is red before anything else runs, naming the key; no
reviewer's secret set is a notice and green.

**Cost.** Each reviewed PR spends model tokens, up to the budget's minutes
(5 to 60, default 15). `/review` asks again after new pushes; nothing else
does. A review that runs out its budget keeps the comments it wrote and
says so in its summary.

**A project that ships to main.** It opens no PRs, so turn on review after
the push instead:

```json
"agents": { "claude": {}, "codex": {} },
"crossReview": { "after": "push", "budget": { "minutes": 15, "pushes": 8 } }
```

Run `keel update` (or `keel render`) and the workflow gains a push trigger
on main and a daily run; a project without `"after"` never gets them.
Each push to main is reviewed once it has landed, as one batch: everything
since the last review. Nothing waits on it. The reviewer is a provider that
did not write the commits (their authors and `Co-authored-by` trailers say
who did); a person's push goes to the first provider listed. Findings land
as comments on the head commit, where its diff holds the line, and all of
them in one issue per push, `keel review after <sha>`:

```bash
keel review acme/notes@4f2c1aa                        # the push's findings, F1, F2, …
keel review acme/notes@4f2c1aa --close F1 --fixed 9e1d2b3
keel review acme/notes@4f2c1aa --close F2 --tracked "#58"
```

The issue closes when every finding is answered. At most `pushes` reviews
run a day (UTC); past that, pushes wait and the next run reviews them
together.

## The commands

```bash
keel review acme/notes#12              # every comment, and which are unanswered
keel review acme/notes#12 --wait       # first wait for the named reviewers to review the head commit
keel review acme/notes#12 --close 3141,3142 --fixed 4f2c1aa
keel review acme/notes#12 --close 3143 --tracked "#57"
keel review acme/notes#12 --close 3144 --not-valid "a PR from a fork is never in a drain queue: scripts/keel/drain.mjs"
```

- The target is `owner/repo#n`, a PR URL, or `#n` for the project's own
  `repo`.
- `--wait` because reviewers post minutes after CI: reading the moment CI
  goes green reads nothing. It waits until each named reviewer has reviewed
  the head commit, or the configured minutes pass; a timeout is said and
  exits 1, never read as "no comments". A reviewer that finds nothing may
  post no review at all (Codex reacts 👍 and updates its status board), so
  the reviewer's own comment marking the head commit `completed` counts as
  having reviewed it.
- Reviewers are named in `.keel/keel.json` `"review": {"reviewers":
  [...], "wait": <minutes>}`; `--reviewer <login>` overrides for one call.
  With none named, threads and review bodies are read, conversation
  comments are not, and nothing is waited for.
- `--close <id>[,<id>…]` with exactly one of `--fixed <commit|vX.Y.Z>`,
  `--tracked <issue|version>` or `--not-valid "<why>"` posts the reply (and
  resolves, for fixed and not valid). Each is refused without its value.
  Pass several ids comma-separated in one call rather than looping in the
  shell. There is no "all": each id is named because each was validated.
- `--close` closes only what was read. Every read leaves a receipt (the
  ids it showed, comment counts and hashes of full comment/review content)
  in keel's cache, outside the repo:
  `$KEEL_CACHE`, else `$XDG_CACHE_HOME/keel`, else `~/.cache/keel` (macOS
  too), as `reviews/<owner>__<repo>__<n>.json`. `--close` refuses, posting
  nothing, an id that read did not show, one with a reviewer's follow-up
  since, or any call while a comment it does not name is new since the
  read. In-place edits also require a fresh read, including edits while an
  agent issue is being created; its tracking reply is withheld. These checks
  use content and identity, never elapsed time. Older receipts without content
  identity require another read. This exists because a
  close list once built from a query of every unanswered thread swept in
  four threads posted minutes after the last read, two of them security
  findings, and answered them "fixed" unread. Validating stays your
  judgement; the receipt only makes sure nothing is closed that was never
  shown.
- `--gate` only for a phase that opted in (above).

`keel --agent-help review` is the exact reference, with the JSON shape.

Building a PR body the way keel does, in a script of your own:

```bash
node scripts/keel/pr-body.mjs --input body.json --files changed.txt
```

- `--input` is the structured body: the summary, the evidence rows, the
  door and its surfaces, the notes.
- `--files` is a file of paths, one per line, that becomes the Summary's
  tree: the paths the commit actually carries, not a list written by hand.

## What you'll see

`keel review` lists each comment with its kind, author, first line, id and
whether it is answered. It exits **0** when every comment is answered, **1**
when any is not (or `--wait` timed out, or `--gate` is not yet satisfied),
**2** when GitHub could not be read, or on usage.

A PR body you can judge from its top: the tree, the gate's line, the door.
Read the door first. A two-way door with a green gate is cheap to merge and
cheap to undo; a one-way door names its paths, so read those.

`pr-body.mjs` exits 2 on bad input (an unknown door or surface, a summary
that is not a picture), naming what is wrong, rather than writing a body
that hides it.

## What it never does

- Nothing in keel refuses a merge because a thread is open, unless a phase
  opted in with `review: wait`.
- Nothing resolves a review thread without a reply that says which form it
  is.
- No model writes a PR body or judges a review comment: the body is built
  deterministically, and judging a comment valid is the reader's, recorded
  in the reply.

## See also

- [Conduct a phase](conduct-a-phase.md): the conductor is one of the agents
  that answers reviews.
- [Keep the fleet current](keep-the-fleet-current.md): the update PRs most
  reviewed across the fleet.
- [`docs/research/2026-10-06-answering-reviews.md`](../research/2026-10-06-answering-reviews.md)
  and [`docs/research/2026-10-06-pr-and-retro.md`](../research/2026-10-06-pr-and-retro.md):
  the designs.
- [`docs/reconciliation.md`](../reconciliation.md): the `keel-impact` block.

### Robot pull requests

`keel/robot-` PRs use the robot workflow's explicit other-provider review and
shared build/review allowance. Standalone cross-review refuses these branches,
even with a matching prefix or an owner `/review` comment. Continue the issue
conversation through the robot; reading and answering review findings with
`keel review` remains available. See [the robot guide](the-robot.md).
