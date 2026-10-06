# Climb nights: an agent improves one number while the project sleeps

Design, 6 October 2026. Phases 35–37 build it.

## Why

On 6 October an agent hill-climbed keel by hand: the test suite went from
48s to 23s in eight kept changes, each measured against noise, with the
gate green after every one and a list of what was tried and dropped. It was
the most productive hour of the day, and nothing in keel makes it happen
again, or for anyone else. The owner asked for the night to do this kind of
work in every project: performance, build time, test time, lessons, and
Loop's findings.

## Two nights, kept apart

| | The night (phase 10) | A climb night (this design) |
| --- | --- | --- |
| Does | measures, writes the health page, opens one data PR | an agent does one job, opens one code PR |
| Cost | nothing; deterministic, no model | model tokens, within a budget per project |
| Merges | its data PRs, when the gate passed (drain) | **never**; a person reads and merges |
| On | every adopted project | opted in, per project and per job |

The measuring night stays free and trustworthy; the climbing night is a
choice with a price. The second reads the first: the health page says which
number is worst.

## The protocol, shared by every job

What made 6 October's climb trustworthy, written down once and shipped as
the brief every job runs under:

1. **Baseline first**: the job's number, the median of k runs, with its
   spread.
2. **One change at a time.**
3. **Measured against noise**: base and candidate run alternately in the
   same job, so both see the same machine (CI runners are noisy). A change is
   kept when it beats the base by the job's margin (default 5%) in two
   alternated rounds.
4. **Behaviour unchanged**: the project's gate passes after every kept
   change; no test is deleted, skipped or weakened (with phase 33's ledger,
   the same test names ran before and after); no output, exit code or file
   format changes; no dependency added.
5. **Bounded**: stop at the job's attempt limit, after three misses in a row,
   or at the budget.
6. **One PR**, on `keel-climb/<job>/<date>`: the before-and-after table, each
   kept change as its own commit with its numbers, and what was tried and
   reverted, with why. A night that keeps nothing opens nothing, and says so
   on the health page.

## The jobs

| Job | Climbs | Its number | Phase |
| --- | --- | --- | --- |
| `test-time` | the suite's wall time, slowest files first | the gate's test command, timed; per-test from phase 33's ledger | 35 |
| `hygiene` | flaky tests | the ledger (phase 33): fix the test, or file it | 36 |
| `build-time` | the build | a `build` command the project names, timed | 36 |
| `perf` | the project's own benchmark | a `perf.command` printing one number, and which way is better | 37 |
| `lessons` | the project's lessons: merge, reword, promote a guard | phase 31's distill, in the project | 37 |
| `loop` | Loop's findings: pull, then an agent proposes a rank for each | the loop practice, plus the propose step | 37 |

A job is a small module: how to read its number, its margin and limits, and
the brief's job-specific paragraph. Adding one is a practice change.

## How a night chooses

- **One job a night.** The job tied to the measure furthest outside its bound
  goes first (a slower suite → `test-time`; a flaky test → `hygiene`);
  otherwise the jobs rotate. A job with an open PR waits for it.
- **The budget** is in `.keel/keel.json`:
  `"climb": { "jobs": ["test-time"], "budget": { "minutes": 45 }, "schedule": "nightly" }`.
  No `climb` key, no climb night.
- **Where it runs**: `keel-climb.yml` in the project's own repo, through
  `anthropics/claude-code-action` with the `CLAUDE_CODE_OAUTH_TOKEN` the
  `claude` practice already declares. Projects run on their own (design §6):
  no keel at runtime, no keel token.
- **Its rights**: `contents: write` to push its own prefix, `pull-requests:
  write` to open its PR; never `main`, never a merge, never a person's
  branch. The workflows test holds it to that, as it holds the night.

## Judged by what it delivers

- A job whose PRs are closed unmerged three times in a row proposes its own
  retirement on the health page.
- Phase 34's escapes, per release, say whether climbing is breaking things.
- The health page records each climb night: the job, what was kept, minutes
  spent.

## Deliberately open

- **Cost reporting.** Whether the action exposes tokens spent per run; until
  it does, minutes are the budget's unit.
- **More than one job a night**, for a project with budget to spare. One,
  until a week of climb nights shows the PR load a person can read.
- **Where it runs for projects without GitHub Actions minutes to spare**: a
  Claude Code routine on a schedule is the alternative runner; same brief,
  same protocol.
