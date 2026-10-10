# The robot, and keel's sense of time

The owner, 2026-10-09: "I like the 'robot' piece, also the 'timing' piece
and really getting good at understanding time which agents normally
don't... and using that to see when things are getting bad and then
proposing fixing them."

Two ideas, four phases:

- **The robot** (phase 54). An agent works issues it was handed, on its
  own, through keel's existing sandbox and review.
- **Time** (phases 55 to 57). Tests judge the code, not the machine. keel
  remembers where time goes. And when time gets worse, the night proposes
  the fix, which the robot can then build.

## Why agents get time wrong

An agent sees one run. It doesn't know what a test usually takes, whether
the machine was busy, or whether a failure is new or one it has seen
before. So it does what keel's own history shows:

- **A flaky test is "fixed" by giving it more wall-clock time.** keel raised
  the climb comparison test's base sleep from 600 to 1500 ms, and the
  timing-hygiene floor from 300 to 1000 ms. The test still judges the wall
  clock, just with a wider margin, and every run now pays for it.
- **A slow test is waited out.** The agent gives the command a long
  timeout, runs it in the background, or interrupts it. Nothing records
  that it happened, so the next agent pays the same cost.
- **A red run is investigated from scratch.** The test ledger (phase 33)
  can say that a test is flaky, but not what it said when it failed. A
  known flake looks like a new failure.
- **The gate creeps.** keel's `npm run check` takes about 100 seconds and
  runs before every push. Its 60 test files add up to 795 seconds, run in
  parallel, and one file, `tests/climb.test.mjs`, takes 100 seconds alone:
  the gate can't finish before it does (the ledger, 2026-10-09). No measure watches it get slower week by week:
  `slow_tests` compares one run against its median, which a slow creep
  never trips.

keel already has the pieces to do better. The test ledger keeps every
run's per-test times. The night measures `flaky_tests`, `slow_tests`,
`build_time` and `conduct_cost`, and writes one proposal a night. What is
missing is context about the machine, memory across runs, a way to tell
code time from machine time, and a path from "this got worse" to "here is
the fix, built".

## Phase 54: the robot

An issue labelled `keel:agent` is work an agent can do alone. keel works
these issues one at a time, as a pass beside climb and tend.

- **The rubric.** An issue is the agent's when all of these hold:
  - it says what is wrong and how to see it (a command, a test, the
    steps);
  - it says how to tell when it's fixed;
  - it needs nothing only the owner can give (no product choice, no
    secret, no exit-3 step);
  - it is one change that fits in one run;
  - it doesn't depend on work that isn't on main.

  `keel issue new --agent` writes an issue in that shape. An issue the
  owner labels that misses part of it gets one comment naming what's
  missing, and is not worked.
- **The trigger is GitHub's own.** `keel-robot.yml` runs on `issues:
  labeled|reopened` and on `issue_comment: created`, but only for a
  comment from someone with write access to the repo, and never from a bot.
  A concurrency group means one issue at a time per project, and a weekly
  schedule picks up anything missed. No server listens anywhere.
- **The sandbox is climb's.** The same three jobs (agent read-only, judge,
  publish), the same provider adapters (Claude or Codex), and the same
  guards. The result is a PR, never a push to main. The PR is reviewed by
  the other provider (phase 45) and merged by a person.
- **The issue is the conversation.** keel posts the agent's last message
  on the issue: what changed, how it knows, the PR, or the one question it
  needs answered, with choices. A comment from the owner starts the next
  run on that issue with the comment included.
- **Spend is opt-in.** The pass is off until `.keel/keel.json` turns it
  on, with a budget the owner sets per week. When the budget runs out, the
  robot waits and says so on the board.
- **Where issues come from.** A review comment answered `--tracked` can
  file its issue in the agent's shape. So can an accepted proposal from the
  night (phase 57). So can any agent that finds a fault outside its own
  work: it files the issue and goes on with what it was doing.

## Phase 55: a test judges the code, not the machine

- **Stalls.** `keel test <file> --stalls [--seed N]` runs a test while
  pausing its whole process group (SIGSTOP, then SIGCONT) for 50 to 500 ms
  at random moments from a seed it prints. The test is compared with a run
  of the same files without stalls. A test that passes without stalls and
  fails with them is judging the wall clock, and keel names it. This works
  on macOS and Linux and needs no cgroups.
- **Virtual time.** The fix is to give the code its clock: `mock.timers`
  in `node:test`, a clock passed in, events counted rather than waited for.
  A test that has moved over can be pinned to run with stalls every time,
  from a fresh seed, so a wall-clock wait that creeps back fails it.
- **Inconclusive.** A part that genuinely judges real time (playback, a
  frame rate) can report `inconclusive` when the machine kept it from
  judging. That fails nothing. The ledger keeps it, and a part that is
  inconclusive in half its runs is a finding.
- **The timing-hygiene rule changes.** It no longer says "sleep at least
  1000 ms". It says "a test that times something runs with stalls or under
  mock timers". keel's own timing tests move first; then the rule ships in
  the practice.

## Phase 56: keel knows where time goes

Every run records the context an agent never has:

- **How busy the machine was.** The load average and core count at the
  start and end of the run, and on Linux the cgroup's CPU pressure. A run
  slowed by a busy machine is said to be that, and is never counted as a
  slower test.
- **Usual times.** Each test's median over its last ten passes, given to
  the runner (`KEEL_USUAL`) so runners can start the longest first. Keel keeps its current
  ordering: the October 9 alternating experiment found no gain (phase 56
  Trajectory). Usual times remain useful evidence, not an unproven optimization.
- **Failure memory.** The first lines of what a test said each time it
  failed. A failure that matches an earlier flake says so up front. A test
  that ends differently on identical files was decided by something besides
  them, and keel says so, with how busy the machine was each time.
- **Creep.** Each test's and the gate's wall time over weeks, so a slow
  rise is visible even when no single run trips `slow_tests`.
- **Tests agents worked around** (local only). From the coding agent's own
  session record on this machine: tests given a long timeout, run in the
  background, or interrupted by hand. This never runs in CI and nothing
  leaves the machine. It's the most direct signal of where the gate hurts.

`keel time` reports all of this for a project, with `--json`. The board's
week strip shows the gate's wall time and the flakes beside the nights and
merges.

## Phase 57: getting worse becomes a proposal, and a fix

The night already writes one proposal. Phase 57 gives time a voice in it:

- **New measures with bounds:**
  - `gate_time`: the gate's wall time against its own trend;
  - `time_creep`: tests whose median rose more than a set factor over four
    weeks;
  - `wall_clock_tests`: tests named by stalls and not yet moved;
  - `inconclusive_share`;
  - `worked_around`: local, reported from the conductor's side.
- **Proposals that name the fix, not just the symptom.** Each time measure
  carries a fix it can propose, for example: "move `climb compare` to mock timers (it
  failed under stalls, seed 4417)", "split `tests/climb.test.mjs`: its 100 s
  of tests is the gate's whole wall time, so it sets the floor", "this test has been worked around 6 times this
  week; it waits on a 1500 ms sleep".
- **Accepted means filed for the robot.** When the owner accepts a time
  proposal on the board, keel files it as a `keel:agent` issue in the
  rubric's shape, with the command that shows the problem and the measure
  that will show it fixed. The robot builds it, the other provider reviews
  it, and the owner merges it. The next night's measure says whether it
  worked.

## What it costs

- **The robot** spends model tokens per issue, within the owner's budget,
  and adds one review per PR.
- **Stalls** cost one extra run of a test, by hand or when a measure asks
  for it. They never run in the gate by default.
- **The time record** adds a few fields per run to the ledger. "Worked
  around" reads local files only.

## Order

55 first, because it fixes keel's own tests and is small. 56 builds on the
ledger. 54 can start in parallel: it reuses climb's jobs. 57 needs 56, and
needs 54 for its last step.
