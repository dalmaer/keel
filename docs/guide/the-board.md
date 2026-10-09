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
- **Broken**: a red CI on a fleet project's default branch, a draft keel
  update PR ("acme/ledger: keel update v0.8.26 fails ledger's check": the
  fleet kept an update whose check failed; its description says what to
  fix), review comments
  unanswered on an open PR you or an agent opened (Claude, Codex, a bot). A
  PR someone else opened waits outside, as "Someone else's PR": its review is
  theirs to answer.
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

### Every walk says, in plain words, what you are asked

A walk used to reach you as its Acceptance box: "⚑ by hand: the owner reads
phases 32 and 33's before-and-after and keeps or retires each lever". The
owner's verdict on that card: "It's hard to grok what this walk is REALLY
about. How can we make it clear what we want the user to do?" So a phase
with a ⚑ walk now carries a **Your part** section, written for someone who
has not read the phase:

```
## Your part

- **Ask:** Decide whether to keep two rules added on 6 October: …
- **Why:** Keel keeps extra process only if fewer defects slip through after it; …
- **Look at:** The table, its last row first; how it was counted is in the evidence (a link).
- **Choices:** Keep both | Drop the proof-plan rule | Drop the test-run record | Not enough data yet
- **Keeps it open:** Not enough data yet
- **Takes:** 5 minutes
- **Then:** Keep both: recorded; nothing changes. Drop the proof-plan rule: recorded; the conductor drafts a phase …
- **Ready:** yes
```

On the board the **Ask is the card's headline**; the phase's number and
title shrink to a small label that opens its drill-down. Under it: the Why,
the table (a Markdown table after the bullets) or the Look at line, "Takes
…", then **one button per choice** (the first is the primary one) and "with
a note". After you choose, the card says what happens next: that choice's
part of **Then**.

Two rules keep the list honest:

- **Ready.** `**Ready when:** <what must happen first>` in place of
  `**Ready:** yes` means you cannot act yet: the walk is listed under
  **Waiting**, with that reason, never under Yours, whatever its `waits:`
  says. Ready means you could act today.
- **A choice is only a record.** It checks the walk's box and writes
  "Chose: <choice>." (and your note) into the evidence. What it changes, a
  rule dropped or a budget set, is the conductor's next step, and Then says
  so. A choice not in the list is refused, and nothing is written.
- **Keeps it open.** A choice listed there ("Not enough data yet") records
  your answer the same way but ticks nothing: the walk stays open, its
  status is unchanged, and you can choose again later. Its button is never
  the primary one, and its result says **recorded, still open**.

A walk whose phase has no Your part yet still shows, as before, with a small
**needs plain words** marker; `npm run roadmap -- --check` notes it (advice,
never a failure).

### Answers are recorded, never typed twice

Each "yours" item carries the actions that settle it, and each runs a keel
verb, so the board never writes a file its own way:

- a walk with a Your part: each choice runs
  `keel walk done <phase> --choice "<choice>"` (with `--note` when you
  wrote one);
- a walk without one: **Done — looks good**, or **Done, with a note**, runs
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
- `--json` reads it without a server: `{items: [{waits, kind, title, why,
  read, link, source, phase, next, actions}], counts, sources, fleet,
  phases, roadmap}`. A walk item also carries `yourPart` (`{ask, why,
  look, choices, takes, then, ready, table, box}`, with `parts` when it has
  several, or null), `ready`, and `ask`; a choice's action has `choice` and
  its `then`. `phases` is every phase by number (done when, the
  Acceptance boxes with `checked` and `walk`, next action, the last few
  Trajectory lines, evidence, goal, status, owes, waits, after);
  `roadmap` is built/total per goal and the headline.

The server listens on 127.0.0.1 only, and every request needs the token in
the printed URL, so another page in your browser cannot post to it. The
page carries a strict Content-Security-Policy: nothing loads from
elsewhere, and its one inline style and script run only with that load's
nonce. It reads the files fresh on every load and every refresh; Ctrl-C
stops it. GitHub is read less often: the reviews, loose-ends' PRs and the
fleet are kept 10 minutes in keel's cache, so the minute-by-minute refresh
asks GitHub nothing; **Refresh** (and `keel board --json --fresh`) reads
again. The reviews stop under the quota floor (1000 GraphQL points left of
the hour's 5000, shared by every tool on your login), saying "saving your
GitHub quota (N left until HH:MM)", and the footer says when GitHub was read,
what that cost and what is left.

```bash
keel walk done 44 --note "Dropped one on a coyote; it landed."
keel walk done 12 --box 3 --note "Read the page on a phone."
keel walk done 34 --choice "Not enough data yet" --note "Look again after November's review."
keel walk decide --proposal docs/health/2026-10-08.md --decline "Phase 52 covers it."
keel walk decide --proposal docs/health/2026-10-08.md --accept
```

- `walk done` checks the phase's open ⚑ box, appends your note to the
  phase's first evidence file under "The owner's read (date)" (a new
  evidence file when it has none), and when no box is left open sets the
  phase built: `owes` and `waits` dropped, `since` today, Next action
  `None.`. It regenerates the roadmap.
- `--choice "<choice>"` answers the phase's Your part instead of `--note`:
  the evidence row reads "Chose: <choice>." and the note after it, if any.
  It must be one of the Choices (case aside); anything else exits 2,
  writing nothing.
- `--box <n>` when the phase has more than one open walk: boxes count from
  1 down the Acceptance list. A box that names a test or a command is built,
  not walked: it is refused, and nothing is written.
- `walk decide` writes one line at the end of the page's Proposal section,
  `**Decided <date>: accepted|declined** — why`. The board and
  `keel loose-ends` stop listing it. An accepted proposal becomes a phase
  with `keel phase new`.

## What you'll see

A working page, not a report; it works offline, in light or dark, from a
phone to a wide screen.

- **The header**: the project, today, a search box, **Refresh** and how long
  ago it was read. It refreshes itself every minute while the tab is
  showing (never while you are writing a note).
- **Four tiles**: Yours, Broken, The agent's, Waiting (on time and outside).
  Each is a filter: click one to see only that column, again to see all.
- **Yours**, first and widest, grouped as Walks to do, Decisions, Set up,
  Questions and Repos to tidy. A walk's card leads with its Ask (above).
  Every other card has its title, the why, a **Read**
  link (the phase file on GitHub, or the PR) and its action as a button.
  "With a note" opens a box on the card. After a button, the card shows the
  verb's result: **Done — uncommitted: commit when the gate passes**, with
  the diff folded underneath, or the refusal, plainly. Results stay on
  their cards across refreshes; a card that left the board (a walk done
  moves its phase to built) shows under "Done this session".
- **Broken**, in red: the PR with unanswered review comments, the red CI,
  the draft update PR, each with its link and what to do.
- **The agent's**: the buildable phases in order, the first marked
  **next**, then the agent's loose ends.
- **Waiting**: "on a date" (sorted by the date) and "on something else" (a
  window of time, a step outside).
- **Roadmap**: built of total per goal as a bar, and the headline.
- **Fleet**: a card per project, with its practice version, CI and last
  health page, linking to the repo.
- **Sources**, at the foot: each one ok, partial or n/a with why.

Click a phase's title (or press Enter on its card) for its **drill-down**:
Done when, the Acceptance boxes checked and open with the walks marked, the
next action, the latest Trajectory lines and its evidence.

Keys: `/` search, `j` and `k` move between cards, `Enter` opens the focused
phase, `r` refreshes, `?` lists the keys, `Esc` closes or clears. Every
control is a real button, so the page works without a mouse and reads
aloud; an action's result is announced.

`keel board --json` exits **0** when it drew the board, whatever it found.
`walk` exits **0** when it wrote, **2** on a refusal (a box that is not a
walk, a choice not in the list, a proposal already decided), with nothing
written.

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
