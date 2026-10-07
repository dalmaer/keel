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
- **The budget compared is today's** (`.keel/keel.json`). A run under an
  older budget is still counted against it; the line names the budget it
  used.

## Where the numbers come from

`gh api` on the workflow's runs on the default branch (completed, newest
first), then each run's jobs, finding the agent step by name. The night's
script keeps a map from workflow to that step's name (keel-climb.yml →
"Climb", keel-tend.yml → "Tend", keel-cross-review.yml → "Review"), and a
test holds the map equal to each shipped workflow's step that uses
claude-code-action. A run that never reached the agent step (no secret, the
pass not picked, a non-matching PR) is not a run of the budget, and is
skipped.

## Judged by

The owner reads tend's line after a few weeks and changes its budget, or
says the line didn't help them decide.
