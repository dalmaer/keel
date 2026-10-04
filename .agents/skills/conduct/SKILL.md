---
name: conduct
description: Walk this project's phases with the conductor pattern — read where it stands, brief a subagent on the next phase, verify the named proof yourself, record what changed course, move the status, commit the phase whole to main, and go on until a step needs a person. Use for "/conduct", "conduct the next phase", "do phase 3", "where do we stand", or "keep going".
argument-hint: "[status | <phase number> | one]"
---

<!-- Source: dglazkov/isocan .claude/skills/conduct/SKILL.md @ 7227f325 (Apache-2.0).
     Adapted by keel for one-file-per-phase projects (docs/phases/NN-*.md).
     Keel manages this file: change it upstream in keel, or send the change home with `keel lessons`. -->

# conduct: one phase, verified, recorded, committed

The phases in `docs/phases/` are the contract. Each one is a file. Its front
matter owns its status, and its sections say **Done when**, **Acceptance**,
**Proof**, **Deliberately open** and **Next action**. `docs/goals.json` says
what the phases are for. `docs/design.md` (or the project's equivalent), if
the project has one, is the argument they cite.

The session that runs this skill is the **conductor**. It does not build. It
briefs a subagent that builds, then verifies the proof the phase named up
front, never taking the subagent's word for it. Only then does it write the
record, run the gate once on that final tree, and commit. Then it goes on to
the next phase. (A phase of a file or two may be built by the conductor
itself: see *Small phases* in §1.)

**The default is unattended.** The conductor stops for a person, and a person
is needed for exactly three things:

- a token or a login;
- money or a cloud resource (a ⚑ step);
- a hand the phase names (a real device, a decision assigned to someone by name).

Everything else is the conductor's to decide, record and commit: a wrong
design, a proof that can't run as written, two docs that disagree.

`AGENTS.md` applies to everyone, conductor and subagent alike. Invoking
`/conduct` is the "land this": the conductor commits and pushes each phase to
`main` without asking again.

**No remote?** If `git remote` prints nothing, skip every pull, push and CI
step below: the walk ends at the local commit on `main`. Say so in the report.

## Arguments

- `/conduct`: orient, then conduct phase after phase until a step needs a
  person or nothing is left. Commit after each phase, and push if there is a
  remote. The user reads
  progress from the commits.
- `/conduct status`: orient and report. Change nothing.
- `/conduct <N>`: conduct that phase and stop. If a phase it depends on isn't
  built, conduct that one first and say so.
- `/conduct one`: the next phase only, then stop.

## 0. Orient

```sh
npm run next                          # the next phase whose dependencies are built, and its next action
node scripts/roadmap.mjs --json       # everything, if you need more
```

Then read, in this order:

1. the phase file;
2. the design sections it cites, if the project has a design doc;
3. the **Trajectory** of the phases it depends on (what the design didn't know);
4. `docs/lessons.md` rows that share its shape.

Note the wall clock. The commit records what a phase cost.

Keep the conductor's own context lean, because it outlives every builder:

- Send long output to a file and read the lines that matter (`grep -E "fail|not ok|# pass"`).
- Don't re-read what a builder already summarised unless verification needs it.
- On a long run, keep a short handoff file in the scratchpad: current commit,
  owned paths, decisions, open failures.

**Three gates before any code:**

- **The docs agree.** If the phase's Proof, its Acceptance and the design
  disagree, fix the docs first, as their own commit. Building on a
  contradiction produces something that satisfies one document and not the other.
- **Its dependencies are built.** `depends:` says which phases. Conduct an unbuilt one first.
- **⚑ steps are asked, not done.** List them to the user with the price, and
  get a yes for each. Before stopping to ask, do every part that doesn't need
  the answer, so the ask is the only thing left.

## 1. Brief

Write the brief to a scratchpad file, so it can be reread, reused if the
subagent must be restarted, and quoted in the commit.

**Point, don't paste.** The subagent can read the repo, and `AGENTS.md` is
already in its context. Name the phase file, the design sections and the
lessons by path and heading. In words, the brief carries only what the docs
*don't* say:

- decisions taken in this session;
- which files are whose;
- who else is working in the tree;
- where to stop.

Aim for under 600 words.

```
# <project> phase <N>: <title>

Contract: docs/phases/<NN-name>.md. Design: <doc> <sections>.
Trajectory that binds you: <one line each, only ones that change what you build>.
Decided here, not in the docs: <…>

## Who else is in the tree   (another builder's paths, and which red checks are theirs)
## What you own
Files under <paths>. Not docs/phases/, docs/ROADMAP.md, docs/lessons.md or the
evidence: the conductor writes the record.

## Where you stop
- At each ⚑ step without a yes: build up to it, report.
- When the proof would need a facade (a fixture that can't fail, a shim that
  answers the test and nothing else): stop and say so. That's a finding.
- When the design turns out wrong: stop, say what you found and what you'd
  change. The conductor changes the design.
- A bug beside the phase: report it, don't fix it.

## How you test
The test files you touched or wrote, by path (`node --test tests/<file>`),
as often as you like. Do NOT run the whole check (`npm run check`): the
conductor runs it once on the integrated tree. Never run a build beside
another build.

## What you return (under 600 words)
1. What was built: the files, and one paragraph on how it works.
2. The proof: exact commands from the repo root, each with its exit code and
   the one line that says so. Not "tests pass", and not the whole output.
3. What you couldn't do, why, and where you stopped.
4. Candidate trajectory lines: dated, one claim each, about forty words, only
   for things that change what comes after.
5. Anything a later phase should know that the docs don't say.
```

Spawn the subagent with the Agent tool (`general-purpose`), in the background.

**Small phases.** A phase of a file or two (a seed, a doc, one small script
and its test) may be built by the conductor itself, without a brief or a
subagent. Everything after the build is unchanged: verify the named proof,
write the record, run the gate. Say so in the evidence and the commit body:
"built by the conductor (small phase)".

Parallel builders belong inside one phase, split by file ownership. Never run
two phases of one project at once: two builders in one checkout see each
other's half-done files. Name each builder's paths in the other's brief, and
say which red checks to expect from the neighbour.

A subagent's report isn't shown to the user; relay what matters.

## 2. Verify

The builder's report is a map. The phase's **Proof** is the territory. Run it
as written, from the repo root, and read exit codes, not tails.

- `git pull --ff-only` **first**, if there is a remote.
- Then mark the phase's new files intent-to-add: `git add -N <new files>`.
  Anything that measures with `git ls-files` can't see an untracked file
  locally, and it will fail the same check in CI after the commit (lesson 10).
  Never stage before an autostash pull: the pull hands staged changes back unstaged.
- `git status --short`: only the phase's files changed, no leftovers, no
  `.env`, nothing under `docs/phases/`.
- The named Proof, command by command. Not yet the whole check: that runs
  once, after the record (§3), so it covers the tree you will commit.
- The walk, when the phase has one: a real browser, a real device, a real
  `gh` call. A phase with a walk isn't built until the walk is walked. If a
  person must walk it, write the steps into the evidence file.
- Open each new test and ask two things. Could it fail? Does it exercise the
  thing, or a stand-in for it? A test that asserts what the code returns,
  rather than what the phase requires, proves only that the code agrees with
  itself.
- Read the diff for a facade, and for real data carried into fixtures.
  Fixtures are synthetic: "Acme", always.

**Work that fails goes back down.** Send it to the same subagent with
`SendMessage`, so it keeps its context. Include the exact command, the exact
output, and the line of the Proof it violates. Don't fix code yourself; the
conductor edits documents (except in a small phase it built itself).

## 3. Record

When the proof holds, and only then, write the record, all in one change:

- **Set the phase's `status:`** in its front matter (`built`, or `partial`
  with what waits), with `since` (today) and a `note` saying in one line why
  it stands there. Add the evidence path, relative to `docs/`
  (`evidence/<date>-<slug>.md`). Check the Acceptance boxes that the proof
  actually showed. The roadmap check fails a phase whose boxes are all
  checked and evidence named but whose status wasn't moved.
- **The evidence file**, `docs/evidence/<date>-<slug>.md`, from
  `docs/templates/evidence.md`: what was run, with exit codes; what was
  checked by hand; what was not. Never write expectations as observations.
- **Trajectory** in the phase file: only what changes the course. One line
  per claim: `- **YYYY-MM-DD** — Claim. Evidence.` A phase that went as
  planned writes `*Nothing — the phase went as planned.*`
- **Deliberately open**: settle the questions that were settled, in place,
  dated, saying what settled them.
- **Next action** for the phase, if it isn't built.
- **Lessons**: a new row only if a bug turned out to have a shape.
- **What people and agents are told**: if the change alters what a person or
  an agent would be told — a verb, a flag, a practice, a default — update
  the README (if the project has one), AGENTS.md and any agent guide in the
  same commit. A test catches the tables; nothing catches the prose but you.
- **Other phases** this one changed the facts for: `grep -rn` the term across
  `docs/` and fix each mention.
- `npm run roadmap`.

Then **the whole check, once**, on the final tree, record included:
`npm run check`. It is the only full run, and it comes last so it covers what
you commit (the roadmap check in it reads the status you just set). Builders
tested by file; this is the integrated tree. If something fails, re-run just
that, alone, before calling it a flake; after a fix, run the whole check again.

## 4. Commit

One commit per phase, with the phase whole: code, tests, record. Commit the
tree the gate just checked in §3; if anything changes after it, run it again.

- **Title:** `phase <N>: <title>`, or `<area>: <what>` for something smaller.
- **Body:** the argument, in prose a reader who wasn't there can follow. What
  was built, what the proof showed, what changed course, and what it cost in
  wall time.

Land on `main`, no pull request:

1. With a remote, integrate `origin/main` before the gate run in §3, and
   regenerate the roadmap if it conflicts.
2. Stage an **explicit list** of the phase's files, taken from the builder's
   report and `git diff --stat`. Never `git add -A`: a builder still writing in
   the tree creates files between your read and your stage.
3. Read `git show --stat HEAD` before pushing.
4. Push, and follow CI on that exact commit while preparing the next brief.
   With no remote, stop at the local commit: there is no push and no CI.

Write a short report between phases (the phase, its new status, the proof and
what it printed, what changed course). Don't wait for a reply.

## Stopping

The conductor stops for a person, and for nothing else. Record the stop first,
so a later session can pick up from the docs alone:

- Set status to `partial`, with a note naming exactly what waits on whom.
- Put the ask in Next action.
- Commit, and push if there is a remote.

Then look past it: if a later phase needs none of that, conduct it. The final
report lists every ask in one place, each in one sentence with its price.

Two things look like stops and aren't. Decide them, record them, and go on:

- **The design is wrong.** Change the design doc (or, if the project has none,
  the phase) as its own commit, with the reason, then re-brief. A phase can be superseded; it can't be quietly redefined.
- **The proof can't run as written.** Fix the Proof, say why in the commit,
  continue. Never mark a phase built against a proof other than the one it named.

If in doubt, ask: is the missing thing a credential, money or a hand? If not,
it's yours.

## Things that have gone wrong before

- A subagent said the suite passed. It had run the suite piped into `tail`,
  and six tests had failed. Read the exit code.
- Builders ran the whole suite 53 times in one session, and the conductor's
  run repeated all of it. Builders test by file.
- A brief pasted the phase, the design and the house rules. The conductor read
  them once and the subagent twice. Point, don't paste.
- A script shipped without its library, because `git add -A` ran while a
  builder was still writing. Stage an explicit list; read `git show --stat HEAD`.
- An autostash pull handed staged files back unstaged, and the commit missed
  them. Pull first, then mark files intent-to-add.
- A subagent fixed a bug beside the phase, and the fix was wrong, because the
  fix was a design call. Report it; don't fix it unasked.
- Trajectory became a work log, and the one line that redrew the map was
  buried. Trajectory holds course changes only.
- A real project's names ended up in a fixture and then in a shipped example.
  Fixtures are synthetic.
- The conductor proved a drift guard by editing a file, then undid it with
  `git checkout`, which also threw away the builder's uncommitted change to
  that file. Probe a temp copy, never the tree a builder has written.
- The shell's cwd was reset between commands. Use absolute paths in every
  command you give a subagent.
