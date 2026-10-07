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
  → `build-time`, a `perf` row → `perf`, `lessons_without_guard` →
  `lessons`), or to what the repo itself shows (`lessons_since_distill`: the
  table's rows since the last distill pass → `lessons`; `loop_untriaged`:
  Loop's untriaged findings → `loop`), with `flaky_tests` → `hygiene` ahead
  of every other, else the next in rotation (`.keel/climb.json`, carried by
  the climb PR; `hygiene`, `lessons` and `loop` never run by rotation). A job with an open `keel-climb/<job>/` PR waits
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
  PR's Merge danger prints; `perf` also runs `perf.check` when the config
  names one. A proposals night (`lessons`, `loop`) runs the gate and refuses,
  naming each: any path but its proposals (`.keel/climb/lessons/`; the
  findings, `docs/LOOP.md` and loop's `afterRenderWrites`), any change to
  the lessons table (by row), a proposal edited, a finding decided tonight
  or a decided finding changed. Deciding is the owner's.
- `distill [--json]` is a lessons night's worksheet: the project's own
  table (`.keel/keel.json` `lessons`, default `docs/lessons.md`), each row
  with its provenance and family, the families the owner accepted, the open
  proposals, the rows since the last pass. `distill propose --kind
  family|reword|standardise … --read "…"` writes one proposal under
  `.keel/climb/lessons/` (phase 31's rules, from `scripts/keel/distill.mjs`)
  and, on a lessons night, commits it alone. It never writes the table.
- `loop-pull` is a loop night's pull, in place of keel-loop's that day: the
  loop practice's `pull --no-prove`, committed by the script. Loop
  unreachable (no `STITCH_API_KEY`, no stitch, a failing pull) is a notice
  and the night's line, never red; the agent then proposes for the findings
  already here, with `node scripts/loop.mjs propose`.
- `revert --why` and `settle` drop what no compare kept (a proposals night's
  `settle` keeps its commits and drops only what was never committed).
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

**The Budget line.** With climb, tend or cross-review on, the night's
health page carries one `Budget:` line: for each pass, its agent step's
minutes in its last runs (at most 8, newest first, from GitHub's record of
the workflow's runs: the `Climb`, `Tend` or `Review` step's start to end),
⏱ on each that ran out (cancelled, or used the budget less one minute), and
a suggestion against today's budget: *extend* when half or more ran out,
*shorten to N* when none used more than half (N the most used, rounded up
to 5), *hold* otherwise, *too few to say* below 4 runs. n/a with why when
gh cannot read the runs. A suggestion, never a change: `budget.minutes` is
the owner's to set.

**Config** (`.keel/keel.json`; no `climb`, no climb night):

```json
"climb": { "jobs": ["test-time"], "budget": { "minutes": 45 }, "schedule": "nightly", "margin": 0.05, "attempts": 10 }
```

`jobs` from the table below; `budget.minutes` 5 to 180; `schedule`
`nightly` or `weekly` (Mondays, UTC; a dispatch runs any day); `margin` 0.01
to 0.5; `attempts` 1 to 50; `testCommand` (default `npm test`); for
`build-time`, `build` (the command) and `buildOutput` (the file or directory
it writes), and optionally `buildBudgetMs` (the night's `build_time` bound;
without it the night records the time, unbounded); for `perf`, `perf`:
`{ "command": "…", "better": "lower"|"higher", "unit": "ms", "check": "…" }`
(the command prints one number on its last line; `check` is the project's
own perf check, run by the guard). `loop` needs the `loop` practice. A bad
value is a red run naming it.

| Job | Climbs | Its number | Judged by |
| --- | --- | --- | --- |
| `test-time` | the suite's wall time, slowest files first | `testCommand`, timed | `compare` |
| `hygiene` | the flaky tests the test ledger names: fix it, or file it | the flaky count (`.keel/test-runs`) | `prove-steady` |
| `build-time` | the build | `build`, timed | `compare`; output byte-identical or explained |
| `perf` | the project's own benchmark | `perf.command`'s last line, `better` either way | `compare`; `perf.check` |
| `lessons` | the lessons table: family, reword, standardise | rows since the last distill pass | the owner, who reads each proposal |
| `loop` | Loop's findings: pull, then a proposed rank for each | untriaged findings | the owner, who decides each |

**A proposals night's PR** lists what it proposed, for the owner: a lessons
night, each proposal file (decide it by applying it to the table yourself
and setting its `status:` to accepted or declined; a declined one is never
proposed again; a lesson that belongs home is sent by you, with `keel
lessons`); a loop night, each finding with its proposed rank and why (decide
with `node scripts/loop.mjs decide`). Nothing proposed opens nothing.

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
`scripts/keel/climb.mjs`, `tend.mjs`, `distill.mjs` (phase 31's rules, which
keel's `lib/distill.mjs` re-exports), `.agents/climb/PROTOCOL.md`,
`TEND.md`, `.agents/climb/jobs/test-time.md`, `hygiene.md`,
`build-time.md`, `perf.md`, `lessons.md` and `loop.md` (all managed). A
loop night reads `STITCH_API_KEY`, the loop practice's secret. A hygiene night gathers
CI's `keel-test-runs` artifacts first, and its workflow may file one issue
(`issues: write`) on this repo, never elsewhere. It reads the `night` practice's `lib.mjs`, `test-ledger.mjs`,
`pr-body.mjs` and (tend) `improve.mjs`.

**Lineage.** Keel phases 35, 36, 37 (perf, lessons, loop) and 38 (tend), from the 6 October 2026 hill-climb on keel's own
suite; design in keel's `docs/research/2026-10-06-climb-nights.md` and
`docs/research/2026-10-06-tend-pass.md`.
