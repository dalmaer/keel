# Conduct a phase

## When you'd reach for this

A phase is specified (its Done when, Acceptance, Real surfaces and Proof are
written) and you want it built, by agents, without taking their word for
what they built. Or you want the walk to go on, phase after phase, while
you do something else, and to stop only when it needs you.

## What it does, and why it works that way

The **conductor pattern** splits the work in two. The session that runs
`/conduct` is the conductor: it does not build. It briefs a builder (a
subagent) on one phase, then verifies the phase's named proof itself, writes
the record, runs the gate once, and commits the phase whole. Each part
exists because of a failure that was paid for:

- **The conductor runs the proof itself.** A builder once reported "suite
  passed" from a run piped into `tail`, with six tests failing. The report is
  a map; the Proof is the territory. Keel's lesson 4 is the shape: a green
  subset hides a red suite.
- **Builders test by file; the conductor runs the whole gate once.** In one
  session builders ran the whole suite 53 times, a quarter of all the time
  spent, and the conductor's own run repeated it. Verification at every
  level costs more than it catches (lesson 5).
- **Point, don't paste.** The brief names files and headings; the builder
  reads them. A brief that pastes the phase and the design is read twice
  and ages the moment a doc changes.
- **One commit per phase, with its record.** Status, evidence, trajectory and
  code land together, so the history says what was claimed and what proved
  it, in one place.
- **Built needs evidence.** The evidence file says what was run, with exit
  codes, and what was not. Never an expectation written as an observation.

**The default is unattended.** The conductor stops for exactly three things:
a token or a login, money or a cloud resource (a ⚑ step), or a hand the
phase names (a real device, a decision assigned to a person). A wrong
design or a proof that can't run as written is not a stop: the conductor
fixes the document, says why in the commit, and goes on.

### Measuring handoffs

For an approved experiment, follow the [session handoff guide](session-handoff-trials.md).
Reserve a run before its work and use the returned policy snapshot. Keep a
compact handoff at a safe boundary, including owner choices, proof, current
revision and dirty paths, active jobs, remaining budget and exact next action.
The receiving session checks current records and its phase claim before writing.
Finish with the whole task's measured cost and evidence-backed outcome, including
failed work and reload overhead. The deterministic audit can tune the threshold
inside its envelope; it cannot launch sessions or accept a phase. This is an
explicit CLI protocol, not an installed automatic provider hook.

### From a free phase to a merged one

The whole path, with what stops each of the two failures it was built
around: a phase built twice, and a review that never ends.

1. **Find a free phase.** `keel next` fetches, then lists every phase whose
   dependencies are built: the free ones first, then the claimed ones with
   who holds each. If it can't read the claims (no network, `gh` failing) it
   exits 2 and lists nothing as free.
2. **Claim it.** `keel phase claim <n>` pushes one shared branch,
   `claims/phase-<n>`. The server accepts that push only when the branch
   does not exist, so of two sessions claiming at once exactly one gets it,
   and the other is told who holds it: take another phase, or stop. An open
   PR whose branch names the phase counts as a claim too.
3. **Build and prove it**, as above, on `<provider>/phase-<n>`.
4. **Open the PR; it is reviewed.** With the cross-review practice on,
   Claude reviews what Codex wrote, and Codex what Claude wrote. Each comment
   is validated against the code, then answered: fixed, tracked in an issue,
   or not valid. See [Reviews and PRs](reviews-and-prs.md).
5. **Stop at three rounds.** A round is a push a reviewer answered with at
   least one finding. At the limit (three, or `"review": {"rounds": N}` in
   `.keel/keel.json`), `keel review <pr>` exits 3 and the session stops
   pushing fixes. It sorts each open finding with `keel review <pr> --class
   security|overwrite|approval|other <ids>`, which leaves the finding
   unanswered, and reports. The choice is yours: merge with the rest
   tracked (after fixing what is a security hole, overwrites your files or
   skips an approval), split the PR, or close it.
6. **Merge.** A person merges; keel never does. The claim ends when the
   phase is built on the default branch.
7. **Your walk.** A phase whose building is done and whose ⚑ box is your
   read shows on the board as yours.

The claim is a record every session can see, not a lock: a session that
never runs `keel next` or the conduct skill is not stopped. A claim belongs
to the session that made it, not to its working tree: a second session
started in the same tree is refused like any other, unless it names the same
provider and has the same session id, or shows the token keel printed when
the claim was made (`keel phase claim <N> --token <token>`). The session id
is `KEEL_SESSION`, else the one Claude Code sets; an agent that sets neither
(Codex, as far as keel knows) is told apart by its provider only, so two of
its sessions sharing one tree are not told apart. A claim nobody has pushed
to for seven days shows on the board as yours to release or leave.

**A retro after real work.** When a phase's commit changed more than
`docs/`, the conductor runs `keel retro` and answers its seven areas,
ending in at most five candidates (a check, an AGENTS or skill line, or a
lesson). The owner picks; nothing is applied unpicked. See
[Loose ends and the retro](loose-ends-and-retro.md).

## The commands

In Claude Code, the skill is `/conduct`:

- `/conduct`: orient, then conduct phase after phase until a step needs a
  person or nothing is left. Use it when you want progress while you're away.
- `/conduct status`: orient and report, change nothing. Use it to see where
  things stand in the conductor's terms.
- `/conduct <N>`: one named phase (and any unbuilt phase it depends on,
  first). Use it when the order matters to you more than the roadmap's.
- `/conduct one`: the next phase only, then stop. Use it when you want to
  read each phase's result before the next begins.

The conductor's own commands are the project's, not keel's:

```bash
keel next            # what to conduct, and its next action; what is free, what is claimed
keel phase claim <N> # before building: the phase is yours, or someone holds it
npm run check        # the gate, once, on the final tree with the record in it
keel retro --since <the commit before the phase>   # the retro worksheet, after the commit
```

**A fix is proven by its test failing without it.** Every `fix:` commit
carries a `Proven-by:` trailer, and `keel prove` writes it. It runs the
named test twice, each time in a fresh scratch copy of your repository:
once with the fix's files put back as they were before the fix, once with
the fix. Both sides see the same tree, and your working tree is never
touched, not even by what the test writes. List only the fixed code in
`--fix`, not the test: a test changed by the fix would run in its old form.

```bash
keel prove tests/anvil.test.mjs --fix lib/anvil.mjs --trailer
# VERIFIED: tests/anvil.test.mjs — red without the fix, green with it
# Proven-by: tests/anvil.test.mjs — VERIFIED — "Expected values to be strictly equal: -1 !== 3 (drops one anvil)"
```

The verdict is VERIFIED (red without the fix, green with it), NOT WORKING
(green without it, so the test does not catch the bug; or red with it) or
INCONCLUSIVE (the test cannot run without the fix, say it does not load).
Paste the trailer into the commit message, or record it in the phase's
evidence with `--evidence <phase>`. The base is the commit before the fix
(HEAD's parent once the fix is committed, HEAD before); `--base <ref>` names
another, and `--name <pattern>` picks one test in the file.

The skill itself lives once, at `.agents/skills/conduct/SKILL.md`, and Claude
Code reaches it through the `.claude/skills/conduct` symlink. It is a managed
file: if your project needs it to say something different, change it in
keel, or send your edit home ([Lessons and learning](lessons-and-learning.md)).

## What you'll see

A commit per phase on `main`, titled `phase <N>: <heading>`, whose body says
what was built, what the proof showed, what changed course, the gate's
result line and the wall time. Between phases, a short report. At a stop,
the phase set to `partial` with a note naming what waits on whom, and the
ask in its Next action, so a later session can pick it up from the docs
alone. The final report lists every ask in one place, each with its price.

A phase whose proof needs the commit itself (a fresh clone, CI on the pushed
commit) stays `partial` in its own commit, and moves to `built` in the next
one, once the walk is walked.

## What it never does

- It never marks a phase built on a builder's word, or against a proof other
  than the one the phase named.
- It never invents evidence. A surface not yet walked keeps the phase short
  of built, and the evidence says which.
- It never runs a ⚑ step without the owner's yes, and it never runs two
  phases of one project at once: two builders in one checkout see each
  other's half-done files.
- It never applies a retro candidate the owner did not pick.

## See also

- [Plan with phases and goals](plan-with-phases-and-goals.md): writing the
  phase it conducts.
- [Reviews and PRs](reviews-and-prs.md): what to do when the work goes
  through a PR with a reviewer.
- [`practices/conduct/README.md`](../../practices/conduct/README.md), and the
  skill itself at
  [`.agents/skills/conduct/SKILL.md`](../../.agents/skills/conduct/SKILL.md).
