# Budget use: each budgeted pass shows what it spent

The owner turned tend on at 30 minutes a week and asked to track how that
is used, to know whether to extend or shorten it. The same question holds
for climb (45 minutes a night) and cross-review (minutes per PR): a budget
is set by guess, and nothing says afterwards whether the guess was right.

## What the night shows

One **Budget** line on the health page for each budgeted pass that is on:

```
Budget: tend 2, 3, 30⏱ of 30 min (last 3 runs; too few to say) · climb 41⏱, 45⏱, 44⏱, 45⏱ of 45 min (last 4: 4 ran out; extend)
```

- **Minutes used** is the agent step's wall time in each run (its
  `startedAt` to `completedAt`, from GitHub's own record of the run). Not
  the agent's report, and not the job's: setup, the guard and the PR are
  keel's time, not the budget's.
- **⏱ ran out**: the step was cancelled by its timeout, or used the budget
  less one minute.
- **The suggestion**, over the last runs (at most 8, at least 4):
  - *extend* when half or more ran out (the agent is cut off mid-work);
  - *shorten to N* when none used more than half (N: the most any used,
    rounded up to 5, at least 5);
  - *hold* otherwise; *too few to say* below 4 runs.
- **n/a, with why**, when GitHub cannot be read, as every night measure.

## What it is not

- **Not a measure with a bound.** A budget used fully is not unhealthy, and
  the night's selftest refuses a measure that can never be outside (lesson
  6). It is a line, like Climb and Tend.
- **Never a change.** The suggestion is the owner's to take: the budget is
  money, and a person sets it.
- **The budget compared is today's** (`.keel/keel.json`), and only the
  runs since it became today's are counted: a run under an older budget is
  not judged against it (raised 15 → 30, runs that ran out at 15 would read
  as healthy and say shorten). The since is read from the default branch's
  commits touching `.keel/keel.json` (one list, then the config at each,
  newest first, at most 10 read a night) until one has another budget for
  that pass, compared as written: a budget left to the default equals only
  another left to the default, never a number, since a default can change
  between keel releases; the entry names it: `tend 2 of 30 min since
  2026-10-06 (last 1 run; too few to say)`. The whole history read and none
  differs: no since, every run counted. A read that stopped short (the cap,
  a full page): the oldest commit read is the since. The history
  unreadable: that pass is n/a with why, never every run. (Settled
  2026-10-07, from Codex's reviews of ledger#84 and the v0.8.7 PRs.)

## Where the numbers come from

`gh api` on the workflow's completed runs, newest first (on the default
branch for climb and tend; on every branch for cross-review, whose runs are
on each PR's branch), then each run's jobs, finding the agent step by name. The night's
script keeps a map from workflow to that step's name (keel-climb.yml →
"Climb", keel-tend.yml → "Tend", keel-cross-review.yml → "Review") and to
the step right after it, "Did the agent run?", and a test holds the map
equal to each shipped workflow's step that uses claude-code-action and the
step after it. A run that never reached the agent step (no secret, the
pass not picked, a non-matching PR) is not a run of the budget, and is
skipped. So is a run whose agent never started (a refused secret, a bad
model): the agent step is continue-on-error, so it says `success` even
then, and its "Did the agent run?" step's `failure` is what says so. A run
without that step (from before it existed) is counted.
(Settled 2026-10-07: keel's climb runs 37528477651 and 37522297684 had
Climb `success` in 16–17 s and "Did the agent run?" `failure`.)

## Judged by

The owner reads tend's line after a few weeks and changes its budget, or
says the line didn't help them decide.
