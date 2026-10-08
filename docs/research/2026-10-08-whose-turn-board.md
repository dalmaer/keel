# The board: whose turn is it, and what is mine?

The owner, 2026-10-08: "I notice that I am always asking 'What's next on the
roadmap?'" — and asked for a web application showing the project's state:
every walk the human can do, every question back for them.

## Why the roadmap does not answer it

The roadmap is written for the agent: phase files, a generated ROADMAP.md,
and `keel next`, which names one phase. The owner's question is a different
one — whose turn is it, and what is mine — and its answer is spread over six
places keel already knows:

- **phase files**: `owes: walk` and ⚑ boxes (the owner's walks), buildable
  phases (the agent's), dated ones ("on or after 2026-11-01");
- **loose ends** (`keel loose-ends --json`): repos, branches, PRs, owner
  steps, each with its move and commands;
- **reviews** (`keel review`): unanswered comments on open PRs;
- **health pages**: the night's one proposal, waiting for a decision;
- **the inbox** (`keel learn`): lessons waiting to be decided;
- **the fleet** (`keel fleet --json`): each project's version, health, CI,
  machine PRs.

And two facts are only in prose, so a board would have to guess them:

- **"not before"**: phase 13 is "on or after 2026-11-01", but `keel next`
  names it every day because nothing machine-readable says so;
- **whose walk**: `owes: walk` says a walk is owed, not who or what owes it
  (the owner's read, a date, a secret to set).

## The shape

**One source, `keel board --json`**: every open item, each with `waits`
(one of `owner`, `agent`, `time`, `external`, `broken`), a title, why it
stands there, the exact thing to read or run, a link, and the source it came
from. It reads the sources above; it derives nothing they do not already say.

**Two fields on a phase**, so the board never guesses:

- `after: 2026-11-01` — not buildable before that date: `keel next` and
  nextPhase skip it until then, and the board lists it under time.
- `waits: owner | time | external` on a phase that `owes: walk` — whose walk
  it is. With none, `owner` (a ⚑ box is the owner's by definition).

**The app, `keel board`**: a localhost web page, no dependencies, served by
keel's CLI. Columns, in the order the owner reads them:

1. **Yours**: walks owed, decisions (proposals, retro picks, lessons to
   decide), questions agents asked, things only you can set (a secret, API
   credit, a repo setting). Each with what to read and the link.
2. **Broken**: red CI on a default branch, a failed fleet update, an
   unanswered review on an open PR.
3. **The agent's**: buildable phases in order, each with its next action.
4. **Waiting on time**: with the date or the condition.

Plus a fleet strip: each project's practice version, health and CI.

**Answers recorded, never typed twice**: a "Yours" item carries the actions
that settle it, and each runs a keel verb, so the board never writes a file
its own way:

- a walk: **Done — looks good** (or **Done, with a note**) runs
  `keel walk done <phase> --note "<what you saw>"`: checks the walk's box,
  writes the owner's judgment into its evidence, and moves the status when
  nothing else is open — the same record the conductor writes by hand today;
- a proposal: **Accept** / **Decline: <why>**;
- a lesson in the inbox: **Accept** / **Decline** (`keel learn decide`).

A verb that changes the repo leaves the change as a working-tree diff (and
says so); committing stays the conductor's (the gate runs first, always).

## What it is not

- **Not a second roadmap.** Phase files stay the record; the board reads
  them and writes through keel's verbs.
- **Not hosted.** Localhost, the owner's machine and its `gh` login. A
  published or canvas view (phase 50's isocan canvas) can read the same
  `keel board --json` later.
- **Not the agent's queue.** The agent still runs `keel next`; the board is
  the person's.

## Judged by

The owner stops asking "what's next on the roadmap?": the board answers it,
and a week of walks is settled from it rather than in chat.
