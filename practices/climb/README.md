# climb

**The failure it prevents.** An agent's "it's faster now" with no number
behind it: a speed-up measured once, on a noisy machine, by the agent that
made it, with a test quietly gone. And the opposite failure: the most
productive hour of a project's week (6 October 2026: keel's suite from 48s
to 23s in eight kept changes) happening once, by hand, and never again.

**The rule.** On a scheduled night, an agent climbs one number under one
shared protocol (`.agents/climb/PROTOCOL.md`), and a person merges what it
finds. `scripts/keel/climb.mjs` makes every measurement and every
keep-or-revert, deterministically and with no model, so the numbers in the
PR are the script's:

- `pick` chooses tonight's job: the one tied to the newest health page's
  worst measure outside its bound (`slow_tests` → `test-time`), else the
  next in rotation (`.keel/climb.json`, carried by the climb PR). A job with
  an open `keel-climb/<job>/` PR waits for a person to read it.
- `measure <job> [--baseline]` is the job's number: median and spread over k
  runs. `--baseline` opens the night's record (`.keel/climb/night.json`).
- `compare` runs base and candidate alternately, in worktrees outside the
  repo, for two rounds or more, and keeps a change only when it beats the
  base by the margin in every round. `--decide` acts on it: the numbers go
  into the commit, or the branch resets to the base.
- `guard` runs the project's gate and, with the night's test ledger
  (`scripts/keel/test-ledger.mjs`), checks that every test the base ran
  still ran: none dropped, none skipped.
- `revert --why` and `settle` drop what no compare kept.
- `report` writes the PR body through `scripts/keel/pr-body.mjs` (the
  before-and-after table, each kept change with its numbers, what was tried
  and reverted, the gate line, a two-way door) and the night's one line.

`.github/workflows/keel-climb.yml` runs it: pick, the baseline, then
`anthropics/claude-code-action` with the protocol, the job's brief and the
pick, time-boxed to the budget, its tools unable to push or merge; then
`settle`, `guard`, a final `compare` of the night's base against its end,
`report`, and one PR on `refs/heads/keel-climb/<job>/<date>`. Never `main`,
never a merge. A night that keeps nothing opens nothing: its line is a
notice, in the run's summary, and in the `keel-climb` artifact.

**Config** (`.keel/keel.json`; no `climb`, no climb night):

```json
"climb": { "jobs": ["test-time"], "budget": { "minutes": 45 }, "schedule": "nightly", "margin": 0.05, "attempts": 10 }
```

`jobs` from the table below; `budget.minutes` 5 to 180; `schedule`
`nightly` or `weekly` (Mondays, UTC; a dispatch runs any day); `margin` 0.01
to 0.5; `attempts` 1 to 50; `testCommand` (default `npm test`). A bad value
is a red run naming it.

| Job | Climbs | Its number |
| --- | --- | --- |
| `test-time` | the suite's wall time, slowest files first | `testCommand`, timed |

**What it needs (⚑).** The `claude` practice's secret,
`CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`); until one is set the
run ends green with a notice. Every climb night spends model tokens, up to
the budget's minutes. Turning it on, and the budget, is the owner's call.
The test ledger must be the test script's second reporter for `guard` to
tell a dropped test; without it, guard says it cannot tell (exit 2) rather
than pass.

**Optional.** `keel init` and `keel adopt` leave it off unless asked
(`--with climb`), or `.keel/keel.json` lists it; keel does not switch it on
for itself until its owner says so with a budget.

**Its files.** `.github/workflows/keel-climb.yml`, `scripts/keel/climb.mjs`,
`.agents/climb/PROTOCOL.md`, `.agents/climb/jobs/test-time.md` (all
managed). It reads the `night` practice's `lib.mjs`, `test-ledger.mjs` and
`pr-body.mjs`.

**Lineage.** Keel phase 35, from the 6 October 2026 hill-climb on keel's own
suite; design in keel's `docs/research/2026-10-06-climb-nights.md`.
