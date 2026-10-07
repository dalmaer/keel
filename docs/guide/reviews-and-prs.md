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
  exits 1, never read as "no comments".
- Reviewers are named in `.keel/keel.json` `"review": {"reviewers":
  [...], "wait": <minutes>}`; `--reviewer <login>` overrides for one call.
  With none named, threads and review bodies are read, conversation
  comments are not, and nothing is waited for.
- `--close <id>[,<id>…]` with exactly one of `--fixed <commit|vX.Y.Z>`,
  `--tracked <issue|version>` or `--not-valid "<why>"` posts the reply (and
  resolves, for fixed and not valid). Each is refused without its value.
  Pass several ids comma-separated in one call rather than looping in the
  shell.
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
