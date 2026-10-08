# The board

## When you'd reach for this

- You keep asking "what's next on the roadmap?". The roadmap answers the
  agent's question (which phase to build); yours is a different one: whose
  turn is it, and what is mine?
- You have ten minutes and want to clear what only you can clear: a walk
  owed, the night's proposal, a lesson waiting for a decision.

## What it does, and why it works that way

The answer is already spread over six places keel knows: the phase files,
loose ends, review comments on open PRs, the newest health page, the inbox
and the fleet. `keel board` reads them all and sorts every open item by what
it waits on, in the order you read them:

- **Yours**: walks owed (a phase whose building is done and whose ⚑ box is
  your read), the night's proposal, lessons to decide, a question a session
  asked you, a step marked "⚑ yours" (a repo to keep or delete, lessons to
  send home).
- **Broken**: a red CI on a fleet project's default branch, review comments
  unanswered on an open PR.
- **The agent's**: buildable phases in the order `keel next` would take
  them, then the agent's loose ends (branches, uncommitted files, open PRs).
- **Waiting on time**: a phase dated `after:` a day still to come, a walk
  that `waits: time` (a week of green nights).

Plus a fleet strip: each project's practice version, health and CI.

It derives nothing its sources do not already say. Two facts used to live
only in prose, so the phase files now say them:

- `after: 2026-11-01` — not buildable before that day; `keel next` skips it.
- `waits: owner | time | external` beside `owes: walk` — whose walk it is.

A source that cannot be read (GitHub offline, no fleet here) is shown as
**n/a, with why**, never left out: a missing column would read as "nothing
waiting".

### Answers are recorded, never typed twice

Each "yours" item carries the actions that settle it, and each runs a keel
verb, so the board never writes a file its own way:

- a walk: **Done — looks good**, or **Done, with a note**, runs
  `keel walk done <phase> --note "<what you saw>"`;
- the night's proposal: **Accept** or **Decline** runs
  `keel walk decide --proposal <page> --accept|--decline "<why>"`;
- a lesson: **Accept** or **Decline** runs `keel learn decide`.

A verb that changes the repo leaves the change as a working-tree diff and
says so. Committing stays the conductor's: the gate runs first, always.

## The commands

```bash
keel board                # a page on 127.0.0.1; the URL (with its token) is printed
keel board --open         # the same, opened in your browser
keel board --json         # every item, for an agent or a script
```

- `--open` when you want the browser to come up on its own.
- `--port <n>` when you want the same address each time (a free port is
  picked otherwise).
- `--json` reads it without a server: `{items: [{waits, title, why, read,
  link, source, actions}], sources, fleet}`.

The server listens on 127.0.0.1 only, and every request needs the token in
the printed URL, so another page in your browser cannot post to it. It
reads fresh on every load; Ctrl-C stops it.

```bash
keel walk done 44 --note "Dropped one on a coyote; it landed."
keel walk done 12 --box 3 --note "Read the page on a phone."
keel walk decide --proposal docs/health/2026-10-08.md --decline "Phase 52 covers it."
keel walk decide --proposal docs/health/2026-10-08.md --accept
```

- `walk done` checks the phase's open ⚑ box, appends your note to the
  phase's first evidence file under "The owner's read (date)" (a new
  evidence file when it has none), and when no box is left open sets the
  phase built: `owes` and `waits` dropped, `since` today, Next action
  `None.`. It regenerates the roadmap.
- `--box <n>` when the phase has more than one open walk: boxes count from
  1 down the Acceptance list. A box that names a test or a command is built,
  not walked: it is refused, and nothing is written.
- `walk decide` writes one line at the end of the page's Proposal section,
  `**Decided <date>: accepted|declined** — why`. The board and
  `keel loose-ends` stop listing it. An accepted proposal becomes a phase
  with `keel phase new`.

## What you'll see

The page: four columns (a fifth, for walks waiting on something outside,
only when there is one), each item with what to read and its link, and the
"yours" items with their buttons. A button's output appears under its item.
The fleet strip and each source's state are at the bottom.

`keel board --json` exits **0** when it drew the board, whatever it found.
`walk` exits **0** when it wrote, **2** on a refusal (a box that is not a
walk, a proposal already decided), with nothing written.

## What it never does

- It never commits, pushes, merges or answers a review. A PR's review is
  answered with `keel review --close`, linked from the board.
- It is not hosted: the board is this machine's, with your `gh` login.
- It is not the agent's queue: the agent still runs `keel next`.

## See also

- [Plan with phases and goals](plan-with-phases-and-goals.md): `owes: walk`,
  `waits:` and `after:` in a phase's front matter.
- [Loose ends and the retro](loose-ends-and-retro.md): one of the board's
  sources.
- `keel --agent-help board`: the exact reference.
- [`docs/research/2026-10-08-whose-turn-board.md`](../research/2026-10-08-whose-turn-board.md):
  the design.
