---
name: conduct
description: Walk this project's phases with the conductor pattern — read where it stands, brief a subagent on the next phase, verify the named proof yourself, record what changed course, move the status, commit the phase whole to main, and go on until a step needs a person. Use for "/conduct", "conduct the next phase", "do phase 3", "where do we stand", or "keep going"; and for "/goodnight", when the owner asks to shape tonight's plan.
argument-hint: "[status | <phase number> | one]"
---

<!-- Source: dglazkov/isocan .claude/skills/conduct/SKILL.md @ 7227f325 (Apache-2.0).
     Adapted by keel for one-file-per-phase projects (docs/phases/NN-*.md).
     Keel manages this file: change it upstream in keel, or send the change home with `keel lessons`. -->

# conduct: one phase, verified, recorded, committed

Keel lesson references name the [Keel catalogue](https://github.com/dalmaer/keel/blob/main/docs/lessons.md), not this project’s local lesson numbers.

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

**The default is unattended.** (why: Stopping for routine implementation choices leaves the agreed work unfinished.) The conductor stops for a person, and a person
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
  built (a partial phase marked `owes: walk` counts as done here, as for
  `keel next`), conduct that one first and say so.
- `/conduct one`: the next phase only, then stop.

## 0. Orient

The roadmap command is the project's, never assumed. Read it first:

- `.keel/keel.json` `"practices"` lists `phases` (keel's roadmap): `node
  scripts/roadmap.mjs --next` says the next phase whose dependencies are
  built, and its next action (`npm run next` too, where `package.json` has
  that alias); `node scripts/roadmap.mjs --json` says everything.
- `.keel/keel.json` `"local"` names `phases` (the project keeps its own
  roadmap, and keel's `scripts/roadmap.mjs` is not installed): use the
  scripts its `package.json` names (`next`, else `roadmap`, else what
  `"loop"` `"afterRender"` runs). If none says which phase is next, read the
  phase files' front matter: the lowest-numbered phase not built whose
  `depends:` are built.

**Claim the phase before you build it.** (why: Two sessions built one phase at once, and one of them was thrown away.) With keel's roadmap and a remote,
the first step for a phase is `keel phase claim <N>`, before the brief: it
pushes `claims/phase-<N>`, a branch every session and provider can see.
`keel next` lists the phases that are ready and unclaimed, and the claimed
ones with their holder. A refusal names who holds the phase: take another free
phase, or stop. Never build a claimed phase, and never release a claim that
is not yours: a stale one is the owner's, on the board. If the claims could
not be read, stop and say so. When the phase is committed to `main`,
`keel phase claim <N> --release` clears the branch.

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

- **The docs agree.** (why: Contradictory contracts let a build satisfy one document and violate another.) If the phase's Proof, its Acceptance and the design
  disagree, fix the docs first, as their own commit. Building on a
  contradiction produces something that satisfies one document and not the other.
- **Its dependencies are built.** (why: An unbuilt prerequisite makes downstream proof depend on a promise.) `depends:` says which phases. Conduct an unbuilt one first; a partial one marked `owes: walk` counts as built here (its rest is a walk, not work), as for `keel next`.
- **⚑ steps are asked, not done.** (why: External resources and spending create obligations for the owner.) List them to the user with the price, and
  get a yes for each. Before stopping to ask, do every part that doesn't need
  the answer, so the ask is the only thing left.

## 1. Brief

Write the brief to a scratchpad file, so it can be reread, reused if the
subagent must be restarted, and quoted in the commit.

**Point, don't paste.** (why: Keel lesson 5: repeated context and verification cost more than they catch.) The subagent can read the repo, and `AGENTS.md` is
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
Real surfaces: <the phase's list, word for word, or none>; build so each one can be proven there.
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
conductor runs it once on the integrated tree (with a remote, through
`keel integrate`). Two full gates never run beside each other: the integrator's lock
(`claims/integrate`) lets one run at a time.

## What you return (under 600 words), these sections in this order
0. Done means: your restatement, from below, word for word.
1. What changed: the files and commits, and one paragraph on how it works.
2. Each acceptance box: the test that proves it (file and test name), or why
   it has none.
3. Focused tests: each command you ran, from the repo root, with its exit
   code. Not "tests pass", and not the whole check.
4. Decisions the spec left open: what you chose, and why.
5. What remains: what you couldn't do and where you stopped; candidate
   trajectory lines (dated, one claim each, about forty words); anything a
   later phase should know that the docs don't say.

## Before any code
Restate the success criteria in your own words before writing code.
```

Spawn the subagent with the Agent tool (`general-purpose`), in the background.

**Small phases.** (why: A second session can cost more context than a change of one or two files needs.) A phase of a file or two (a seed, a doc, one small script
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

**Read the report's shape first.** (why: A report that skips a box or an exit code reads as done, and the gap is skimmed past.) Read the builder's
restatement before anything else: where it differs from the phase's Done
when, resolve that first, since the builder built what it restated. Then
check every acceptance box is addressed (a test, or why not) and every
focused command carries its exit code. A report missing either goes back
down (below) before you run anything. Its commands are the builder's
focused tests; the whole check stays yours, once, in §3.

- `git pull --ff-only` **first**, if there is a remote.
- Then mark the phase's new files intent-to-add: `git add -N <new files>`.
  Anything that measures with `git ls-files` can't see an untracked file
  locally, and it will fail the same check in CI after the commit (Keel lesson 10).
  Never stage before an autostash pull: the pull hands staged changes back unstaged.
- `git status --short`: only the phase's files changed, no leftovers, no
  `.env`, nothing under `docs/phases/`.
- The named Proof, command by command. Not yet the whole check: that runs
  once, after the record (§3), so it covers the tree you will commit.
- One proof per Real surface, run in that place: the published package
  installed, the workflow's shell run, the adopted project updated, the
  owner's machine, a real GitHub API call, the fleet read over nights. A
  fixture is not the surface. `none` needs nothing here. A surface not yet
  walked keeps the phase short of built; say which in the evidence.
- Each acceptance box's named check: the test it cites exists and asserts
  the box, the command runs, the ⚑ by hand step is walked or written down.
- The walk, when the phase has one: a real browser, a real device, a real
  `gh` call. A phase with a walk isn't built until the walk is walked. If a
  person must walk it, write the steps into the evidence file.
- Open each new test and ask two things. Could it fail? Does it exercise the
  thing, or a stand-in for it? A test that asserts what the code returns,
  rather than what the phase requires, proves only that the code agrees with
  itself.
- Read the diff for a facade, and for real data carried into fixtures.
  Fixtures are synthetic: "Acme", always.

**Work that fails goes back down.** (why: Parallel fixes by the conductor and builder can overwrite each other.) Send it to the same subagent with
`SendMessage`, so it keeps its context. Include the exact command, the exact
output, and the line of the Proof it violates. Don't fix code yourself; the
conductor edits documents (except in a small phase it built itself).

## 3. Record

With reconciliation enabled, include one `keel-impact` JSON fence in the PR
body naming affected phases, decisions, superseded plans and evidence. Check
the actual diff. Update those records and their next action in the same PR,
or give per-record reasons for leaving them unchanged; no impact needs a
reason too. A merge never ticks acceptance, proves production, or establishes
lived-in use. Preserve historical evidence. Revalidate any saved correction
proposal against current records and remote facts; record edits are manual
review, never night data for automatic merge.


When the proof holds, and only then, write the record, all in one change:

- **Set the phase's `status:`** in its front matter (`built`, or `partial`
  with what waits), with `since` (today) and a `note` saying in one line why
  it stands there. Add the evidence path, relative to `docs/`
  (`evidence/<date>-<slug>.md`). Check the Acceptance boxes that the proof
  actually showed. keel's roadmap check (`scripts/roadmap.mjs`) fails a
  phase whose boxes are all checked and evidence named but whose status
  wasn't moved; a project's own roadmap may not check it, so check it
  yourself there.
- **The evidence file**, `docs/evidence/<date>-<slug>.md`, from
  `docs/templates/evidence.md`: what was run, with exit codes, against the
  phase's commit by its title (it doesn't exist yet), or the base commit and 'working tree'; what was
  checked by hand; what was not. Never write expectations as observations.
  The gate runs after the record, so the evidence names the gate **command**
  (`npm run check`) and what it covers, not its result; the gate's result line
  (exit code, test count) goes in the commit body (§4).
- **Proofs that need the commit** (a clean checkout of the committed tree,
  a fresh clone, CI on the pushed commit) can't be in this record. Leave
  their Acceptance boxes unchecked and the status `partial`, with a note
  naming the walk. Walk them right after the commit (§4), then add the
  result to the evidence, check the boxes and move the status in the next
  commit.
- **Trajectory** in the phase file (`## Trajectory`, after Next action): only what changes the course. One line
  per claim: `- **YYYY-MM-DD** — Claim. Evidence.` A phase that went as
  planned writes `*Nothing — the phase went as planned.*` A defect found
  after a phase was built is recorded in that phase's Trajectory as
  `- **YYYY-MM-DD** — Escape: …`; the night counts it (`escapes`).
- **Deliberately open**: settle the questions that were settled, in place,
  dated, saying what settled them.
- **Next action** for the phase: the next step if it isn't built; once it
  is built, `None.` (or what lived-in needs, when the project counts it:
  `"phases": {"livedIn": true}` with keel's roadmap). A partial phase whose
  building is done and whose rest is a walk gets `owes: walk` and a Next
  action naming the walk. A project that keeps its own phases (`"local"`
  names `phases`) follows its own roadmap's rules for both: it may not read
  `owes:` or `livedIn`, so record the walk in the Next action and keep the
  lived-in step its roadmap asks for.
- **Lessons**: a new row only if a bug turned out to have a shape.
- **What people and agents are told**: if the change alters what a person or
  an agent would be told — a verb, a flag, a practice, a default — update
  the README (if the project has one), AGENTS.md and any agent guide in the
  same commit. A test catches the tables; nothing catches the prose but you.
- **Other phases** this one changed the facts for: `grep -rn` the term across
  `docs/` and fix each mention.
- The project's roadmap command (§0; `node scripts/roadmap.mjs` with keel's).

Then **the whole check, once**, on the final tree, record included:
`npm run check`. It is the only full run, and it comes last so it covers what
you commit (the roadmap check in it reads the status you just set). Builders
tested by file; this is the integrated tree. If something fails, re-run just
that, alone, before calling it a flake; after a fix, run the whole check again.
With a remote, that one run is `keel integrate`'s, after the commit (§4):
finish with `keel ready` and leave the full gate to the integrator. Without a
remote, run it here.

## 4. Commit

One commit per phase, with the phase whole: code, tests, record. Commit the
tree the gate just checked in §3; if anything changes after it, run it again.

- **Title:** `phase <N>: <heading>`, where the heading is the phase file's
  `# ` heading, word for word: it is the source. Or `<area>: <what>` for
  something smaller.
- **Body:** the argument, in prose a reader who wasn't there can follow. What
  was built, what the proof showed, what changed course, and what it cost in
  wall time. It carries the gate's result line from §3 (`npm run check`: exit
  code, test count), which the evidence can't, since the evidence is
  written before the gate runs.
- **A fix is proven by its test failing without it.** (why: Keel lesson 38: a check can stay green without evaluating its claim.) A `fix:` commit
  carries a `Proven-by:` trailer, from `keel prove <test> --fix <the fix's
  files> --trailer`: it runs the test in a scratch copy with the fix
  reverted, then in another with it, and never touches the tree. Only
  VERIFIED proves the fix. NOT WORKING means the test does not catch the bug:
  make it catch it. INCONCLUSIVE says why it could not tell. Never write the
  trailer by hand.
- **Proofs that need the commit** (§3): walk them now, against the committed
  tree, and record them in the next commit.

Land on `main`, no pull request (unless the phase waits for review, below):

1. With a remote, integrate `origin/main` into the phase's branch first, and
   regenerate the roadmap if it conflicts.
2. Stage an **explicit list** of the phase's files, taken from the builder's
   report and `git diff --stat`. Never `git add -A`: a builder still writing in
   the tree creates files between your read and your stage.
3. With a remote, commit on the phase's branch (`<provider>/phase-<N>`), never
   on `main`: the integrator is what writes `main`. Read `git show --stat HEAD`.
4. **Finish with `keel ready`.** (why: Two sessions that each ran the full gate and pushed ran the expensive path twice for two changes.) It runs only the fast checks
   (`"delivery".fast` in `.keel/keel.json`, and each `--check "<cmd>"`: your
   focused tests), pushes the branch and records it as `ready/<branch>`. It
   never runs the full gate, and refuses a check that is the full gate.
5. **Then `keel integrate`.** It takes the lock (`claims/integrate`), merges
   every ready change onto `main`, runs `npm run check` once on the combined tree
   and pushes it. Its report (how many gate runs, exit, what landed) is the
   gate's result line for this phase: record it in the next commit, as for
   proofs that need the commit. A failing batch is
   narrowed until each failing change is found; the rest land, and the
   failing one is sent back blocked, with the reason. One sent back is yours:
   fix it on its branch and `keel ready` again. Refused because another
   integrator holds the lock: stop there; that one takes your change too.
   Follow CI on the commit it pushed while preparing the next brief.
   With no remote, stop at the local commit: there is no push and no CI.

**Reviews.** (why: An unanswered finding hides whether it was fixed, tracked or rejected.) Every PR the conductor opens or merges (a phase that waits for
review, `keel fleet update`'s PRs, a climb or tend PR): when a PR has reviews, validate each comment against the code first, then answer it with one of the three replies; never leave one unanswered.
Read them with `keel review <repo>#<n>` (`--wait` first when the PR is new:
reviewers post minutes after CI). The three replies:

```sh
keel review <repo>#<n> --close <id>[,<id>…] --fixed <commit>      # valid, fixed: names the commit; resolves
keel review <repo>#<n> --close <id> --tracked <#issue|vX.Y.Z>    # valid, tracked: names where; stays open
keel review <repo>#<n> --close <id> --not-valid "<why>"          # says why, citing the code; resolves
```

Several ids go in one call, comma-separated; never loop over them in the
shell. Read with `keel review` right before closing; `--close` refuses what
you have not read (and anything that arrived since the read), so never build
the id list from a query. A valid finding is fixed in its own commit before the reply names it.
Not a gate: an open thread never refuses a merge, and the night counts what
is left (`reviews_unanswered`).

**A review that keeps going is the owner's.** (why: One PR went ten review rounds of fix-and-push before anyone decided.) A round is one push a reviewer answered with a finding. When `keel review <repo>#<n>` exits 3 the PR
is at its round limit (three unless `.keel/keel.json` `"review": {"rounds": N}`
says otherwise): stop pushing fixes. Sort each open finding you have read
with `keel review <repo>#<n> --class security|overwrite|approval|other <ids>`
(it records the kind and answers nothing), then report the choice it prints
to the owner: merge with the rest tracked, split, or close. Never merge it
yourself.

**A phase that waits for review** (opt-in, for a change the owner is nervous
about): its front matter says `review: wait`, or its issue carries the label
`keel:wait-for-review` (`gh issue view <n> --json labels`). It lands through a
PR instead of a push to `main`: push the phase's commit to `phase-<N>`, open
the PR, `keel review <repo>#<n> --wait`, answer every comment, and merge only
when `keel review <repo>#<n> --gate` exits 0 (every comment answered, each
named reviewer has reviewed the head commit). The default is neither: no PR,
no wait.

**In keel itself, a practice change is reviewed before a release**
(`.keel/keel.json` says `"keel": "self"`). A change under `practices/`,
`migrations/` or `docs/lessons.md` is what the fleet receives, so it lands as
a `claude/` PR: push it to `claude/phase-<N>`, open the PR, and wait for the
other provider's review (cross-review: Codex reviews `claude/` PRs) with
`keel review <repo>#<n> --wait`. Answer every comment; after a fix, comment
`/review` so the head is reviewed again. Merge when every comment is answered
and someone other than the PR's author has reviewed its head. `keel release`
refuses a practice commit that came any other way, naming it; only the
owner's `--unreviewed "<why>"` goes past it, never `--yes`. Records
(`docs/phases/`, evidence, the roadmap) and CLI-only changes may still go to
`main`.

Write a short report between phases (the phase, its new status, the proof and
what it printed, what changed course). Don't wait for a reply.

## 5. Retro

**Reviews first.** (why: A retrospective must not bury unresolved review findings.) For each PR this phase opened or merged (§4): when a PR
has reviews, validate each comment against the code first, then answer it
with one of the three replies; never leave one unanswered.

After the commit, when the phase did real work (its commit changed more than
`docs/`), look at how the session went, not only what it built:

```sh
keel retro --worksheet --since <the brief's base commit>   # the commit before the phase's first
```

The worksheet holds counts and transcript pointers, never transcript text:
failed commands retried, tool errors, permission denials, files read three or
more times, tool calls over a minute, edits reverted. A docs-only range says
so in one line; then there is no retro.

Answer the **seven areas** it lists, a line each: navigation, automatable
checks, missing standards, AGENTS.md health, tool economy, no-op
instructions, information gaps. Then put **at most five candidates** in the
phase report, most serious first, each typed:

- **check**: anything mechanical (a lint, a test, a guard in a script).
  Mechanical violations get deterministic checks;
- **guide/skill line**: a judgment call only;
- **lesson**: a failure shape, through `keel learn`.

**The owner picks.** (why: Keel lesson 51: advice is not the person’s decision.) Nothing is applied unpicked: candidates live in the
report, not the repo, until the owner picks one; a picked check is built as
its own small change (or a phase). Never run a retro from the night or a
climb: unattended, it finds false positives and keeps fixing them.

## Stopping

The conductor stops for a person, and for nothing else. Record the stop first,
so a later session can pick up from the docs alone:

- Set status to `partial`, with a note naming exactly what waits on whom.
- Put the ask in Next action.
- Commit, and push if there is a remote.

Then look past it: if a later phase needs none of that, conduct it. The final
report lists every ask in one place, each in one sentence with its price.

Two things look like stops and aren't. Decide them, record them, and go on:

- **The design is wrong.** (why: Quietly changing acceptance erases the contract used to judge the build.) Change the design doc (or, if the project has none,
  the phase) as its own commit, with the reason, then re-brief. A phase can be superseded; it can't be quietly redefined.
- **The proof can't run as written.** (why: A substitute proof may never check the original claim.) Fix the Proof, say why in the commit,
  continue. Never mark a phase built against a proof other than the one it named.

If in doubt, ask: is the missing thing a credential, money or a hand? If not,
it's yours.

## /goodnight

`/goodnight` is the owner saying what tonight is for. It is not a phase and
not the walk: it shapes the plan the night runs (`keel goodnight`; keel's
`--agent-help night` has the detail).

**Run it only when the owner asks.** (why: A plan offered unasked is keel choosing the night, which the default plan already does without a person.) Only `/goodnight`, or the owner's own words asking for it,
starts it. Never offer a plan unasked: not at the end of a walk, not when the
owner says they are stopping, not on a closed session. Without it the night
runs keel's default plan, and that is fine.

1. **Show the opening.** (why: The owner chooses from what keel read; a summary from memory hides what changed today.) Run `keel goodnight` and give the owner what it
   says: settled today, left open, tonight's plan and the things to try. Say
   any `not read:` line as it is; never fill a gap with a guess.
2. **Shape it by the owner's words.** (why: An item reworded by the agent is no longer the promise the owner made.) Each change they ask for is one
   command: `keel goodnight add <id>` (a thing to try) or `add --title "<their
   words>"`, `drop <id>`, `edit <id> --title "<their words>"`, `budget <id>
   <minutes>`, `skip <path-or-id>`. Use their words as they said them. A
   refusal names why (a sixth build item, a build with no number, something
   settled today): tell them, and let them choose; never work around it.
   Show the draft after each change.
3. **Write it only on "that's the plan".** (why: The push is the summons; a plan the owner never agreed to would run as theirs.) Run `keel goodnight --yes` only
   when the owner says that's the plan, or plainly the same. Anything else,
   including silence or leaving, writes nothing, and the night runs the
   default plan. Then say what was pushed, and stop.

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
  that file. Probe a temp copy or a separate git worktree, never the tree a
  builder or another session is using: a mutation there is lost, committed,
  or tested by someone else.
- The shell's cwd was reset between commands. Use absolute paths in every
  command you give a subagent.
