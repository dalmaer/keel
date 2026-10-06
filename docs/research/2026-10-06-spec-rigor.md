# How rigorous is a keel spec, and how do we climb it?

Analysis, 6 October 2026. Phases 32–34 act on it.

The question: does the path from a spec (issue, design note, phase, roadmap)
to code put the right amount of rigour where it pays, so what ships is solid
and its verification is real? And how do we improve that by measurement
rather than by adding ceremony?

## What keel's own record says

Keel has 32 phases (27 built) and 114 commits in five days. Read off the
repo on 6 October:

| Signal | Count | Reading |
| --- | --- | --- |
| Acceptance boxes | 139 | |
| … naming a test file | 1 | Acceptance is checked by reading prose |
| … naming a command | 32 | |
| Phases with an issue | 2 of 32 | Both from today's spec |
| Trajectory entries | 44 | 10 record a correction after the fact |
| Evidence files mentioning a mutation | 10 of 32 | Mutation proofs are a habit, not a field |
| A phase left as `keel phase new`'s template | passes `roadmap --check`, even as `partial` | Probed today on a copy |

**Escapes**, defects that passed the gate and were found later: keel paid for
nine of its own lessons (1, 13–17, 28, 30, 31), and this week added more
without a row (a CI gate that read a cancelled run as a verdict; ledger's
health pages written into an ignored directory; a stale lock hash; the
tests copying an agent's worktree; the inbox citation check refusing a
dotfile path; the check workflow running twice per PR; one commit made
red). Sorted by cause:

| Cause | Escapes | Examples |
| --- | --- | --- |
| **Tested against a fixture, not the real surface** | most | `npm pack` dropped `.gitignore` (28); a shell string broke in the real workflow (30); a test runner's context made gates hollow (14); the developer's git config (14); a fixture pinned to the live version (17); the worktree in the checkout |
| **The spec never named the interaction** | several | a version gate meeting adopted projects (15); Renovate editing keel's files (31); a project ignoring the health path |
| **Process slip** | few | a commit not gated on the check; render overwriting an edit (13) |

Each escape got a guard afterwards, which is the practice working. Every one
was found by real use: in ledger, on the owner's machine, in a published
install, in a live night.

## What the spec process checks today, and what it does not

**Checked by machine:** front matter and status vocabulary; required
sections exist; a built phase names evidence; the stale-status rule; the
roadmap is regenerated; the gate runs before a commit (since phase 25).

**Checked only by the conductor's reading:** that "Done when" is observable;
that each acceptance box has a check behind it; that the proof is a real
command; that a box's test exists, ran and asserts the box; that the change
was proven where it will actually run.

**Not checked at all:** whether a test is flaky or getting slower; whether
rigour is proportionate (a doc-only phase and a phase that changes every
project's nightly workflow get the same template).

## The right amount of rigour

The record says rigour pays where a change meets a **real surface** it was
not tested on: the published package, a workflow's shell, another project's
repo, the developer's machine, GitHub's API, the fleet over time. It pays
little on a phase that edits a doc. So the spec should ask one question
early, "where does this run for real?", and scale the proof to the answer,
instead of raising the bar everywhere.

## Three levers, each measured

### 1. A spec says how it will be proven (phase 32)

- `roadmap --check` refuses template text left in a section, and an empty
  "Done when", "Acceptance" or "Proof".
- Each acceptance box names its check: a test (`tests/x.test.mjs: "name"`),
  a command in backticks, or `⚑ by hand: who`. A built phase whose boxes
  name nothing is a lint (`acceptance-unchecked`), not a failure, so old
  phases are not rewritten.
- A **Real surfaces** section: the places the change runs for real, from a
  closed list (published package, workflow shell, adopted project, owner's
  machine, GitHub API, fleet over time). Each listed surface needs one proof
  in that place; "none" is a valid answer for a doc-only phase, which keeps
  small phases small.
- With the test ledger (lever 2), a box citing a test is checked: the test
  exists, and it passed in the last recorded gate run.

### 2. Every test run is remembered (phase 33)

The owner's example: when the agent runs the tests, it gets the report, and
also "this test is flaky over the last N runs" or "this is much slower than
its last N runs", as hygiene work. Node's test runner takes a second
reporter alongside the usual one; a ten-line reporter records
`{file, name, outcome, ms}` per test with no dependency (probed today).

- **The ledger.** `scripts/keel/test-ledger.mjs` (a shipped practice file)
  appends each run to `.keel/test-runs/` (ignored locally; uploaded as an
  artifact in CI), with the commit, the tree hash, whether the tree was
  dirty, and the machine.
- **Flaky**: a test that both passed and failed on the same clean tree, or
  whose outcome changed between runs whose files it imports did not. It is
  a fact, not a guess, so it needs no threshold.
- **Slower**: a test whose duration exceeds both twice its median over its
  last N passing runs on the same machine class and a floor (for example
  200 ms more), so noise on fast tests is not news.
- **Where it surfaces.** At the end of the run, one hygiene block naming
  each test and the command to reproduce it; on the night's health page
  (`flaky_tests`, `slow_tests`, bound 0, one proposal); in `keel
  loose-ends`. The AGENTS block says a hygiene note is work: fix it or
  file it, never rerun until green.
- isocan's test profile and shard weights and nerd's pass history are the
  sources to learn from; this is the per-project, dependency-free version.

### 3. Keel measures its escapes, and every rigour change is judged by them (phase 34)

The thing to climb is escapes per built phase: defects found after a phase
was marked built. Its signal is already written down, in a lesson row with
the project's own provenance, a `fix:` commit, or a trajectory correction.

- `escapes` in improve: since the last release, the count of those three,
  each pointing at the phase it escaped from where the record names one.
  Bound: no rise release over release.
- Each lever above is an experiment against it: the baseline is this
  document's count; phase 13's six measures already compare adopted
  projects before and after keel.
- What would show the lever is wrong: escapes that do not fall while the
  ceremony (time from planned to built, words per phase) rises. Then the
  lever goes.

## What not to do

- Not more required sections on every phase. The "Real surfaces" answer
  "none" keeps a doc phase cheap.
- No model in the gate. Lints and the ledger are deterministic; judgement
  stays with the conductor and the owner.
- No rewriting of built phases to satisfy new lints: a lint reports, the
  next time a phase is touched it is brought up to date.
