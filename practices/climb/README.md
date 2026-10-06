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
  worst measure outside its bound (`slow_tests` → `test-time`, `build_time`
  → `build-time`), with `flaky_tests` → `hygiene` ahead of every other, else
  the next in rotation (`.keel/climb.json`, carried by the climb PR; hygiene
  never runs by rotation). A job with an open `keel-climb/<job>/` PR waits
  for a person to read it. A job whose last three `keel-climb/<job>/` PRs
  were closed unmerged proposes its own retirement on the health page, and
  pick skips it until the owner removes it from `jobs` or reopens one.
- `measure <job> [--baseline]` is the job's number: median and spread over k
  runs. `--baseline` opens the night's record (`.keel/climb/night.json`).
- `compare` runs base and candidate alternately, in worktrees outside the
  repo, for two rounds or more, and keeps a change only when it beats the
  base by the margin in every round. `--decide` acts on it: the numbers go
  into the commit, or the branch resets to the base.
- `prove-steady --test "<file>: <name>" [--runs n] [--decide]` judges a
  hygiene fix: the one test, n times (default 20, at most 50) on one clean
  worktree, through the test ledger; steady only with n passes and no fail.
  A name that matches no test is exit 2, never a pass.
- `guard` runs the project's gate and, with the night's test ledger
  (`scripts/keel/test-ledger.mjs`), checks that every test the base ran
  still ran: none dropped, none skipped. Then the job's own guard:
  `hygiene` refuses a diff that, in the flaky test's file, only changes a
  timeout or adds a retry, naming the line (a fix that also changes other
  lines passes, with a note for the person); `build-time` builds base and
  candidate and hashes every file under `buildOutput`: byte-identical, or
  each changed path has a reason (`harmless --path p --why "…"`) that the
  PR's Merge danger prints.
- `revert --why` and `settle` drop what no compare kept.
- `report` writes the PR body through `scripts/keel/pr-body.mjs` (the
  before-and-after table, each kept change with its numbers, what was tried
  and reverted, the gate line, a two-way door) and the night's one line.
  `--issue f`: a hygiene night that proved nothing writes the issue instead
  (the test, its passes and fails on its tree, the command to run it alone,
  what was tried), and the workflow files it on this repo.

`.github/workflows/keel-climb.yml` runs it: pick, the baseline, then
`anthropics/claude-code-action` with the protocol, the job's brief and the
pick, time-boxed to the budget, its tools unable to push or merge; then
`settle`, `guard`, a final `compare` of the night's base against its end,
`report`, and one PR on `refs/heads/keel-climb/<job>/<date>`. Never `main`,
never a merge. A night that keeps nothing opens nothing: its line is a
notice, in the run's summary, and in the `keel-climb` artifact.

A run whose agent failed before its budget ran out (no secret, a bad
model: an error after one turn) is red: `agent-ran`, the step after the
agent's, reads the step's outcome and the action's execution file and
prints only the result's error text (at most 300 characters, saying whether
the secret or the model was refused), and nothing is judged or pushed. A
budget timeout is not red; what was kept is judged (lesson 29).

**The tend pass** (phase 38). With `"tend": { "schedule": "weekly",
"budget": { "minutes": 30 } }` in `.keel/keel.json` (no `tend`, no pass),
`.github/workflows/keel-tend.yml` runs on Mondays, a minute after the
climb's, with the same rights: an agent resolves the night's record
findings under `.agents/climb/TEND.md`, and a person merges one PR on
`refs/heads/keel-tend/<date>`. `scripts/keel/tend.mjs`, through
`climb.mjs`, makes every count and refusal:

- `tend-pick` — whether a pass runs: an open `keel-tend/` PR waits; three
  closed unmerged in a row and tend proposes its own retirement.
- `tend-input [--record]` — the worksheet: the record measures
  (`proofs_hold`, `roadmap_stale`, `phases_stuck`, `evidence_placeholders`,
  `drift`, `lint`) run on the tree beside the newest health page's row,
  reconciliation's findings and proposals (when that practice is on), and
  `keel loose-ends` for this repo (when keel is installed; `KEEL_CLI` names
  it). A source that cannot run is n/a with why, never a zero. `--record`
  opens `.keel/tend/pass.json`.
- `tend-note --finding <id> --propose "…" | --tried "…"` — what only the
  owner can choose (a step back to partial, keep/restore/send home for a
  drifted file, closing a branch or a PR), or what was tried and left.
- `guard --job tend` — refuses, naming the line: any file added or edited
  under `docs/evidence/`, a front-matter status changed to built, lived-in
  or accepted, an acceptance box ticked, any tracked file deleted, and a
  commit that cites no worksheet finding (`Tend: <id>`); then the gate.
- `tend-report [--body f]` — the record measures again on the branch; the
  PR body through `pr-body.mjs` (Summary: finding → what was done;
  Evidence: the record count before and after; Merge danger: a two-way
  door over records and docs; Notes: the owner's checklist and what is
  unresolved; the keel-impact block naming any phase it edits) and the
  pass's line, which the night's health page carries as its Tend line.

A pass that committed nothing opens nothing. The workflow keeps the pass's
record as the `keel-tend` artifact.

**Config** (`.keel/keel.json`; no `climb`, no climb night):

```json
"climb": { "jobs": ["test-time"], "budget": { "minutes": 45 }, "schedule": "nightly", "margin": 0.05, "attempts": 10 }
```

`jobs` from the table below; `budget.minutes` 5 to 180; `schedule`
`nightly` or `weekly` (Mondays, UTC; a dispatch runs any day); `margin` 0.01
to 0.5; `attempts` 1 to 50; `testCommand` (default `npm test`); for
`build-time`, `build` (the command) and `buildOutput` (the file or directory
it writes), and optionally `buildBudgetMs` (the night's `build_time` bound;
without it the night records the time, unbounded). A bad value is a red run
naming it.

| Job | Climbs | Its number | Judged by |
| --- | --- | --- | --- |
| `test-time` | the suite's wall time, slowest files first | `testCommand`, timed | `compare` |
| `hygiene` | the flaky tests the test ledger names: fix it, or file it | the flaky count (`.keel/test-runs`) | `prove-steady` |
| `build-time` | the build | `build`, timed | `compare`; output byte-identical or explained |

**What it needs (⚑).** The `claude` practice's secret,
`CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`); until one is set the
run ends green with a notice. Every climb night spends model tokens, up to
the budget's minutes, and every tend pass up to `tend.budget.minutes`, once
a week. Turning either on, and its budget, is the owner's call.
The test ledger must be the test script's second reporter for `guard` to
tell a dropped test; without it, guard says it cannot tell (exit 2) rather
than pass.

**Optional.** `keel init` and `keel adopt` leave it off unless asked
(`--with climb`), or `.keel/keel.json` lists it; keel does not switch it on
for itself until its owner says so with a budget.

**Its files.** `.github/workflows/keel-climb.yml`, `keel-tend.yml`,
`scripts/keel/climb.mjs`, `tend.mjs`, `.agents/climb/PROTOCOL.md`,
`TEND.md`, `.agents/climb/jobs/test-time.md`, `hygiene.md` and
`build-time.md` (all managed). A hygiene night gathers
CI's `keel-test-runs` artifacts first, and its workflow may file one issue
(`issues: write`) on this repo, never elsewhere. It reads the `night` practice's `lib.mjs`, `test-ledger.mjs`,
`pr-body.mjs` and (tend) `improve.mjs`.

**Lineage.** Keel phases 35, 36 and 38 (tend), from the 6 October 2026 hill-climb on keel's own
suite; design in keel's `docs/research/2026-10-06-climb-nights.md` and
`docs/research/2026-10-06-tend-pass.md`.
