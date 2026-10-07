# Loose ends and the retro

## When you'd reach for this

- **Loose ends**: you sit down after a few days away, or at the end of a
  long one, and want to know what you started and didn't finish, across
  keel and every project checkout: a chat that stopped mid-work, files never
  committed, a branch never merged, a PR waiting, a step only you can take.
- **The retro**: a phase just finished that changed real code, and you want
  to know what made the work harder than it needed to be, so the next phase
  is easier.

## What it does, and why it works that way

### Loose ends

Work gets dropped in the gaps between tools: a Claude Code session that
asked you a question you never saw, a branch from a phase that was
superseded, a lesson row never sent home. Each lives in a different place,
and nothing gathers them. `keel loose-ends` reads them all and changes
nothing:

- **session**: a Claude Code chat that wrote files still uncommitted, whose
  last turn asked you something, or that stopped mid-work. A session whose
  files are all committed is done and never listed.
- **file**, **branch**, **worktree**, **pr**: uncommitted files, branches
  not merged, extra worktrees, open PRs of yours or of keel's machine
  queues.
- **phase**: a `partial` phase whose next action waits on the owner.
- **health**, **inbox**, **lessons**: the night's proposal, proposals
  waiting for a person, lesson rows not yet sent home.

Each item has a short id, one suggested move, and the exact commands for it.
**Nothing is ever run.** Chat text reaches your screen only, never a file:
a mark keeps a fingerprint, not your words.

Projects are this one plus each managed repo in `fleet.json` that has a
checkout beside it (or under `--root`).

### The retro

Keel learns from bugs (lessons) and from the night's numbers. Neither sees
how a working session went: the command that failed and was retried, the
file read five times because nothing said where the answer was, the
instruction that did nothing. The retro looks at exactly that, after real
work, and turns it into at most five candidates for the owner.

- **When**: after a phase whose commit changed more than `docs/`. It is the
  last step of `/conduct`. On a docs-only range it says so in one line, and
  there is no retro.
- **What it reads**: the session's transcript and its subagents', counted:
  failed commands retried, tool errors, permission denials, files read three
  or more times, long tool calls, edits reverted. Each count comes with
  pointers, never the transcript's text.
- **What it asks**, seven areas: navigation, automatable checks, missing
  standards, `AGENTS.md` health, tool economy, instructions that did
  nothing, information gaps.
- **What it produces**: candidates, most serious first, each typed. A
  **check** for anything mechanical (mechanical violations get
  deterministic checks); an **AGENTS or skill line** for a judgement call
  only; a **lesson** for a failure shape.
- **The owner picks.** Nothing is applied unpicked.

It never runs from the night or a climb: unattended, a retro finds false
positives and keeps fixing them.

## The commands

```bash
keel loose-ends                       # everything unfinished, here and in each fleet checkout
keel loose-ends --phase 23            # only what names phase 23
keel loose-ends mark 3fa9c1 park --reason "after the release" --until 2026-11-01
```

- `--phase N` when you are about to pick a phase back up and want only its
  threads.
- `--root <dir>` when your fleet checkouts don't sit beside keel's.
- `--all` to see what you marked hidden, with each mark.
- `keel loose-ends mark <id> resume|park|drop --reason "<why>"`: `drop`
  hides an item for good, `park` until the date (`--until` is required for
  it), `resume` sorts it first. The reason is required because a hidden item
  with no reason is how something gets lost twice. The mark is written in
  that project's `.keel/loose-ends.json`; commit it.

```bash
keel retro --since 4f2c1aa            # the worksheet, from the commit before the phase
keel retro --session <id>             # a specific session, not the newest
```

- `--since <commit>` is the brief's base, the commit before the phase:
  it keeps the transcript to what came after it, and decides whether the
  range was real work.
- `--session <id>` when the newest transcript in this repo is not the one
  that did the work.

## What you'll see

Loose ends: per project, each item with its id, kind, age, move and
commands. GitHub is asked with a short timeout; offline, it says "GitHub not
checked" rather than showing nothing.

The retro: the range, whether it was real work, the session, the counts,
each signal with its pointers, and the seven areas with the signals behind
each.

Both exit **0**: they are worksheets, not gates. **2** on usage, an unknown
id, commit or session.

## What it never does

- Loose ends never runs the commands it suggests, and never writes a chat's
  words to a file.
- The retro never writes anything, never quotes the transcript, and never
  applies a candidate.

## See also

- [Conduct a phase](conduct-a-phase.md): where the retro sits in the walk.
- [Lessons and learning](lessons-and-learning.md): where a lesson candidate
  goes.
- `keel --agent-help loose-ends` and `keel --agent-help retro`: the exact
  reference.
- [`docs/research/2026-10-06-pr-and-retro.md`](../research/2026-10-06-pr-and-retro.md):
  the retro's design.
