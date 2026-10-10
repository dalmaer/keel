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

Both are opt-in, because both spend model tokens. So is the third, the
robot: an agent works the issues you label `keel:agent` (below).

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
- `agent`: which agent runs the pass: Claude (`"claude"`, the default) or
  Codex (`"codex"`). A project that names an agent lists it in `"agents"`
  (`"agents": { "claude": {}, "codex": {} }`). See *Choosing Codex* below.

Check what a project will actually run, with the defaults filled in:

```bash
node scripts/keel/climb.mjs config
node scripts/keel/climb.mjs pick       # which job tonight, and why
node scripts/keel/climb.mjs tend-pick  # whether a tend pass would run
```

Then set the secret, a ⚑ step: `CLAUDE_CODE_OAUTH_TOKEN` (or
`ANTHROPIC_API_KEY`) for Claude, `OPENAI_API_KEY` for Codex. Until the
pass's agent has its secret, each run ends green with a notice.

### Choosing Codex

Set `"agent": "codex"` on `climb`, on `tend`, or both, list `codex` in
`"agents"`, and set `OPENAI_API_KEY`. Two things differ from a Claude night:

- **What it costs.** Codex bills the OpenAI API account per token; there is
  no subscription path. `budget.minutes` still bounds the run, and the
  Budget line still counts minutes, not dollars, so watch the API account
  for the first few nights.
- **Where its commits live.** Codex runs in a sandbox that may write the
  checkout but keeps `.git` read-only, so it cannot commit there, and keel
  never gives it the sandbox that could (`danger-full-access`). So a keel
  step gives it a second git dir, `.keel/agent-git`, holding the night's
  branch, and its brief tells it to commit there. The protocol is
  unchanged: one change per commit, measured, kept or reset. Because Codex
  can write that git dir (its config and hooks too), keel never runs git
  on it afterwards: a keel step copies out only the objects and the one
  branch, into a repo keel makes, and hands those on. From there the
  judge and the PR are exactly as for Claude, and a branch that carries
  `.keel/agent-git` is refused like one that changes `scripts/keel/`.
  Codex's sandbox may also write its temp folder, so keel pins that to
  `/tmp/keel-codex`, never the runner's own temp, where the files that set
  later steps' environment live.

One thing a Codex climb night cannot do: `compare` builds its worktrees in
the OS temp, not beside the checkout, since the checkout's parent is outside
Codex's sandbox. A gate that reads a sibling folder (`../data`) fails its
base there; keep such a project's climb on Claude.

The rest of `climb.mjs` (`measure`, `compare`, `guard`, `prove-steady`,
`report`, the tend verbs) is what the workflows and the agent run; the
reference is `keel --agent-help climb`. You don't need to run them yourself.

## The robot: hand an agent an issue

Climb and tend choose their own work. The robot works the work you hand it:
an issue labelled `keel:agent`, one at a time, through the same sandbox. Each
becomes a PR on `keel/robot-<issue>` that says `Closes #<issue>`, and you
merge it, or close it.

**The issue is the brief, so it has to be one an agent can do alone.** It
says what is wrong and how to see it (a command, a test, the steps), how to
tell when it is mended, and it ticks three boxes: it needs nothing only you
can give (no product choice, no secret, no ⚑ step), it is one change that
fits in one run, and it waits on nothing that is not on the default branch.
`keel issue new --agent` writes it in that shape and files it with the label:

```bash
keel issue new --agent --title "The lid test is flaky" \
  --wrong "tests/lid.test.mjs fails one run in ten" \
  --see "node --test tests/lid.test.mjs, ten times" \
  --mended "ten runs in a row pass" --dry-run
```

Without `--dry-run` it shows the issue and exits 3: the label starts the
robot, which spends on your budget, so filing waits for your `--yes`, on
the project's own repo as on another (`--repo`). The issue template
(`.github/ISSUE_TEMPLATE/keel-agent.md`) is the same shape, for an issue
you write by hand; it puts no label on, so only someone who can label
issues hands one to the robot. An issue that misses a field gets one
comment naming what is missing, and is not worked; edit its body and the
next run reads it again.

**The issue is the conversation.** After a run, the agent's last message
is posted on the issue: what it changed and how it knows it is mended, or
one question with the choices it sees. Your comment there starts the next
run on that issue, with your comment in its brief. Only comments from
people with write access do; a stranger's or a bot's comment runs nothing.
Reopening the issue, or labelling it again, also sends it back.

Switch it on with a weekly budget, the minutes the agent may run each week:

```json
"robot": { "on": true, "budgetMinutes": 120 }
```

`runMinutes` (default 30) is one run's box, and `agent` picks Codex as for
climb. When the week's minutes are spent the robot waits, green, and says
so in the run until Monday. With `cross-review` on, add `"keel/robot-"` to
its `for`: the PR is then reviewed by the provider that did not write it,
when you comment `/review` on it (a PR the workflow opens starts no other
workflow by itself).

## What you'll see

- **A climb PR** on `keel-climb/<job>/<date>`: a before-and-after table,
  each kept change as its own commit with its numbers, what was tried and
  reverted, the gate's line, and the merge danger (a two-way door).
- **A proposals night's PR** lists each proposal or proposed rank; you
  decide each.
- **A robot PR** on `keel/robot-<issue>`: the files it changed, the
  judge's gate line, `Closes #<issue>`, and the agent's last message on the
  issue itself.
- **A tend PR** on `keel-tend/<date>`: each finding and what was done
  (resolved only when the measures, run again, no longer report it), the
  record count before and after, and a checklist of what only you can
  choose, also committed as `docs/tend/<date>.md`. A pass that only
  proposed still opens one.
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
  own branch prefix (the robot's: `keel/robot-<issue>`).
- The agent cannot write to the repo even if a brief or a finding talks it
  into trying: it runs in a job whose token only reads (Codex with no
  GitHub token at all, sudo dropped), and its commits are
  judged in a second read-only job and pushed by a third that runs none of
  the branch's code. A branch that changes `.github/`, `scripts/keel/`,
  `.keel/keel.json`, a lockfile, `.npmrc` or a `package.json` beyond its
  scripts is refused before anything runs. The judge installs (with your
  `setupToken`) on the run's own commit before it takes the agent's
  commits, so none of their code ever runs with that token, and it guards
  from the run's commit, never from the base the agent's record names.
- Tend never writes or edits evidence, never sets a status to built,
  lived-in or accepted, never ticks an acceptance box, never deletes a
  file and never changes anything but records and agent-facing text
  (Markdown under `docs/`, a README, `AGENTS.md`, `CLAUDE.md`, `.agents/`);
  its guard refuses each, naming the line.
- A lessons night never edits the lessons table; a loop night never
  decides a finding.
- Neither runs a retro: an unattended retro finds false positives and keeps
  fixing them.

## See also

- [The night shift](the-night-shift.md): the measures both passes read.
- [Reviews and PRs](reviews-and-prs.md): reading the PR they leave.
- [`practices/climb/README.md`](../../practices/climb/README.md): the jobs
  table, the full config and the protocol.
