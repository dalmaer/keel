# Plan with phases and goals

## When you'd reach for this

You know what the project is for and want to line up the work: what comes
next, what "done" means for it, and how anyone (a person, an agent, the
night) can tell where things stand without asking.

## What it does, and why it works that way

**Goals are outcomes, not dates.** `docs/goals.json` says what the project is
for, one sentence each ("A person can export any meeting's notes as one
file"). A goal's progress is never stored; it is counted from its phases
every time you ask. A stored percentage is a second copy of status, and
status written in two places drifts (lesson 2).

**A phase is one file that owns its status.** `docs/phases/NN-name.md` has
front matter (`status`, `since`, `goal`, `depends`, `evidence`) and
sections. `docs/ROADMAP.md` is generated from the phases and goals, and the
roadmap check fails CI when it is stale. Never edit the roadmap by hand.

**A phase names its proof before it starts.** *Done when* is one sentence
someone else could check. *Acceptance* is boxes. *Proof* is the exact
commands. *Deliberately open* records decisions postponed on purpose, so
they are settled in place later rather than improvised. A known limitation
that could make the phase's output wrong (a suggestion, a count, a verdict)
goes there too, with its effect and when it is settled, never only in the
design's prose. Naming the proof
first is what lets a conductor verify a builder's work instead of trusting
its report.

**Spec 2: each box names its check, and the phase says where it runs for
real.** A phase with `spec: 2` in its front matter (the template writes it,
so every `keel phase new` draft has it) is held to two more rules by the
roadmap check:

- Each Acceptance box names the check behind it: a cited test
  (`tests/<file>: "<test name>"`), a command in backticks, or
  `⚑ by hand: <who>`. A box with nothing behind it is checked by reading
  prose, which is how a claim nobody ran gets believed.
- A **Real surfaces** section lists the places the change runs for real,
  from a closed list (published package, workflow shell, adopted project,
  owner's machine, GitHub API, fleet over time), each with its proof there,
  or the single line `none`. This is where keel's own escapes came from:
  most passed against a fixture and failed on a real surface. `none` keeps a
  doc-only phase cheap, so rigour lands where it pays.

The roadmap check also refuses a phase still holding the template's text, at
any status but superseded. A draft lists in the roadmap the moment it
exists, but it can't pass CI until someone has written what it means.

## The commands

Where things stand, and what to do next:

```bash
keel status          # each goal's built and lived-in counts, and the next phase
keel next            # the next phase: its file, its Done when, its next action
keel phase list      # every phase, as the roadmap reads it
keel goal list       # every goal, with progress counted from its phases
keel goal show G1    # one goal: its phases, its counts, its next phase
```

`keel next` is the one an agent should run first: it picks the first
unfinished phase whose dependencies are built, so it never sends you to work
that is blocked. In a repo whose phases live in the projects shape
(`docs/projects/<p>/phases.md`), `keel next --project <p>` narrows it to one
project; keel reads that shape but never writes it.

Adding to the plan:

```bash
keel goal add "Acme exports notes" --outcome "A person can export any meeting's notes as one file."
keel phase new "Export one meeting" --goal G1 --depends 0
```

- `keel goal add` takes the next free id. `--outcome` is required because a
  goal without an outcome is a topic, not a goal. A goal with no phase yet is
  reported by `keel doctor` until one names it.
- `keel phase new` takes the next free number and drafts from the project's
  template. `--goal` is required: every phase serves a goal. `--depends`
  names the phases it needs built first; that is what makes `keel next` skip
  it until they are.

Taking a goal off the plan:

```bash
keel goal retire G3 --reason "Nobody exports" --phases supersede --yes
```

- `--reason` is required and is written into the goal, so a later reader
  knows why it went.
- `--phases supersede|move:<Gm>` says what happens to its unbuilt phases:
  superseded with the reason, or moved under another goal. Without it,
  retire refuses (exit 2) and lists them, because silently orphaning phases
  is how a plan stops matching the work.
- `--yes` because retiring rewrites phase files. Without it you get the plan
  (exit 3).

After any edit to a phase by hand, regenerate the roadmap with the project's
own script (`npm run roadmap`), then run the gate.

## What you'll see

`keel status` prints one line per goal and the next phase with its next
action. `keel next` prints the phase line, `Done when:` and `Next action:`,
or `Nothing left unbuilt.` `keel phase new` prints the file it drafted and
reminds you the roadmap check refuses it until the template text is gone.

- **0**: done.
- **2**: usage, not in a project, or a project where `phases` is a local
  variant (keel's parser would only call the project's own format an error,
  so it points you at the project's own roadmap instead).
- **3**: `goal retire` without `--yes`.

`keel doctor` reports a draft's template text as the `phase` lint, one line
per section, and `keel --agent-help goals` is the exact reference.

## What it never does

- It never stores progress. Counts are derived on every read.
- It never marks a phase built or lived-in. Built needs an evidence file a
  conductor writes after verifying; lived-in needs someone who used the
  thing.
- It never renumbers a phase. If two branches take the same number, the
  roadmap check and `keel doctor` name both files, and you renumber one.

## See also

- [Conduct a phase](conduct-a-phase.md): what happens once a phase is
  specified.
- [`docs/phases/README.md`](../phases/README.md): the phase contract, as
  keel's own phases follow it.
- [`practices/phases/README.md`](../../practices/phases/README.md) and
  [`practices/evidence/README.md`](../../practices/evidence/README.md).
