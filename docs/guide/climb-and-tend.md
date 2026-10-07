# Climb and tend

## When you'd reach for this

The night tells you what is wrong. These two passes send an agent to do
something about it while you sleep, and leave one PR for you to read:

- **Climb** when a number should be better and nobody has time to push it:
  the suite has grown slow, a test is flaky, the build crawls, the project's
  own benchmark slipped, the lessons table has grown faster than anyone has
  distilled it, Loop's findings wait untriaged.
- **Tend** when the records have drifted from the truth: a stale roadmap,
  lost proofs, stuck phases, placeholder evidence, lints, drift, loose ends.
  The night reports these every night; tend resolves them once a week.

Both are opt-in, because both spend model tokens.

## What it does, and why it works that way

**Two kinds of night, kept apart.** The measuring night is free,
deterministic and on everywhere; its data PRs may merge themselves. A climb
or tend pass is a choice with a price, and its PR is code or records, so a
person always merges it. The second reads the first: the health page says
which number is worst.

**Climb: an agent climbs one number, a script judges it.** On 6 October an
agent took keel's own suite from 48 seconds to 23 in eight kept changes, by
hand, each measured against noise. Climb makes that
hour repeatable, under one protocol (`.agents/climb/PROTOCOL.md`):

- **Every number comes from the script**, `scripts/keel/climb.mjs`, never
  from the agent. An agent's "it's faster now" with no number behind it is
  the failure this prevents.
- **Measured against noise.** Base and candidate run alternately, in
  worktrees, for two rounds or more; a change is kept only when it beats the
  base by the margin in every round. Anything else is reverted.
- **Behaviour unchanged.** The gate passes after every kept change, and the
  test ledger checks every test the base ran still ran: none dropped, none
  skipped. A speed-up that deletes a test is not a speed-up.
- **Bounded.** One job a night, an attempt limit, three misses in a row
  stops it, and a budget in minutes.
- **Chosen by the health page.** The job tied to the worst measure goes
  first (a flaky test before anything else), else the jobs rotate. A job
  with an open PR waits for you to read it. A job whose last three PRs were
  closed unmerged proposes its own retirement: if you keep declining its
  work, it stops asking.

The jobs (`test-time`, `hygiene`, `build-time`, `perf`, `lessons`, `loop`)
and what each climbs and is judged by are in the climb practice's README.
Two are proposals nights: `lessons` and `loop` propose, and deciding stays
yours.

**Tend: the records reach zero, fixed or decided.** Weekly, an agent works
through the night's record findings under `.agents/climb/TEND.md`. It may
repair a reference, refresh a next action already done, bring a doc back in
line with the code, apply a reconciliation correction. What only you can
choose (step a phase back, keep or restore a drifted file, close a branch)
it writes down as a proposal for you.

## The commands

Switch a pass on in `.keel/keel.json` (and `--with climb` when adopting or
initialising). No `climb` key, no climb night; no `tend` key, no pass:

```json
"climb": { "jobs": ["test-time"], "budget": { "minutes": 45 }, "schedule": "nightly" },
"tend": { "schedule": "weekly", "budget": { "minutes": 30 } }
```

Why you'd set each:

- `jobs`: start with one. `test-time` is the safest first job: its judge is
  a timer and the test ledger.
- `budget.minutes`: the most a night may spend. This is the price you are
  agreeing to, so it is yours to set.
- `schedule`: `weekly` when you want to read one climb PR a week rather
  than one a day.
- `margin`, `attempts`, `testCommand`: only when the defaults don't fit
  your suite; `build`, `buildOutput` for `build-time`; `perf` for your own
  benchmark.

Check what a project will actually run, with the defaults filled in:

```bash
node scripts/keel/climb.mjs config
node scripts/keel/climb.mjs pick       # which job tonight, and why
node scripts/keel/climb.mjs tend-pick  # whether a tend pass would run
```

Then set the secret, a ⚑ step: `CLAUDE_CODE_OAUTH_TOKEN` (or
`ANTHROPIC_API_KEY`). Until one is set, each run ends green with a notice.

The rest of `climb.mjs` (`measure`, `compare`, `guard`, `prove-steady`,
`report`, the tend verbs) is what the workflows and the agent run; the
reference is `keel --agent-help climb`. You don't need to run them yourself.

## What you'll see

- **A climb PR** on `keel-climb/<job>/<date>`: a before-and-after table,
  each kept change as its own commit with its numbers, what was tried and
  reverted, the gate's line, and the merge danger (a two-way door).
- **A proposals night's PR** lists each proposal or proposed rank; you
  decide each.
- **A tend PR** on `keel-tend/<date>`: each finding and what was done, the
  record count before and after, and a checklist of what only you can
  choose.
- **Nothing**, when a night kept nothing. Its one line is on the run's
  summary and the next health page. That is a result, not a failure.
- **A red run** only when the agent failed before its budget ran out (a
  refused secret, a bad model), with that error's text. A budget timeout is
  not red: what was kept is still judged.
- **A Budget line** on the health page, to tell whether a budget you set by
  guess was right:

  ```
  Budget: tend 2, 3, 30⏱ of 30 min (last 3 runs; too few to say) · climb 41⏱, 45⏱, 44⏱, 45⏱ of 45 min (last 4: 4 ran out; extend)
  ```

  Each number is the minutes the agent step itself took in one run, newest
  first, from GitHub's own record of the run (not the agent's report, and
  not setup or the PR, which are keel's time). ⏱ means it ran out: cut off
  by its timeout, or within a minute of the budget. Over the last 4 to 8
  runs, *extend* means the agent is often cut off mid-work; *shorten to N*
  means no run used half its budget; *hold* means the budget fits. It never
  changes `budget.minutes` itself: that is money, and you set it. A run that
  never reached the agent (no secret, nothing picked, or the agent never
  started) is not counted, and nor is a run from before you last changed
  the budget: after a change the entry says `since <date>`, and counts
  again from there.

## What it never does

- It never pushes to `main` and never merges. The workflows push only their
  own branch prefix.
- Tend never writes or edits evidence, never sets a status to built,
  lived-in or accepted, never ticks an acceptance box and never deletes a
  file; its guard refuses each, naming the line.
- A lessons night never edits the lessons table; a loop night never
  decides a finding.
- Neither runs a retro: an unattended retro finds false positives and keeps
  fixing them.

## See also

- [The night shift](the-night-shift.md): the measures both passes read.
- [Reviews and PRs](reviews-and-prs.md): reading the PR they leave.
- [`practices/climb/README.md`](../../practices/climb/README.md): the jobs
  table, the full config and the protocol.
