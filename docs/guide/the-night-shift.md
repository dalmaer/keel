# The night shift

## When you'd reach for this

You want to know, each morning, whether the practice is actually working in
a project: is CI red, is the roadmap stale, is a test flaky, are machine PRs
piling up, did something you built last week quietly lose its proof. Or a
night PR has arrived and you want to know what it is and whether to merge it.

## What it does, and why it works that way

Every project with the `night` practice runs `keel-night.yml` once a night
(the schedule is in that workflow). It measures the project, writes a dated
health page, opens at most one PR holding that page, and drains older night
PRs. The rules come from isocan's night shift, and each one was paid for:

- **Measure before anything tries to fix.** Every number on the page comes
  from a command. A model's opinion never appears. The night spends no model
  tokens at all; [Climb and tend](climb-and-tend.md) are the opt-in passes
  that do.
- **An instrument that can't run is broken, never zero.** A grader that
  reports zeros when it breaks is believed (lesson 6). Each measure is `ok`,
  `outside` its bound, `n/a` with the reason, or `broken`.
- **One proposal, never an action.** The page ends with one proposal: a
  broken measure first, else the one furthest outside its bound, and the
  smallest change that would move it. The night writes no issue, opens no
  code PR and edits no phase. A person decides.
- **Bounds only tighten.** `.keel/bounds.json` is seeded on the first
  report and is the project's to edit. When a value beats its bound, the
  bound moves to it; it never loosens. Some measures, where any count is
  news (flaky tests, lost proofs, unsent lessons), are held at zero with no
  ratchet.
- **A red night reaches a person.** A broken instrument or a failing gate
  fails the workflow, and GitHub emails. A measure outside its bound is news
  on the page, not red. A guard that fires into a room nobody is in is no
  guard (lesson 3).
- **A machine queue holds one PR.** Older night PRs are merged when they
  hold only data and still merge, or closed as superseded; the newest merges
  only when the gate passed on that tree, because a PR opened with
  `GITHUB_TOKEN` runs no CI. Five unread machine PRs at once is the shape
  this prevents (lesson 9).
- **Projects run on their own.** The night runs scripts shipped into the
  project (`scripts/keel/`), never a keel checkout or a keel token.

### What the night measures, and why

The full list, with each measure's unit, bound and what it counts, is what
`keel improve --json` prints for your project, and `keel --agent-help
improve` is its reference. By family:

- **Is the gate real?** `gate` runs the project's `check` and fails when it
  fails, or when it passes having run no tests: a gate that ran nothing is
  the commonest hollow check.
- **Do the records say what is true?** `roadmap_stale`, `phases_stuck`
  (unfinished and untouched for weeks), `evidence_placeholders` (a built
  phase whose evidence is the blank template), `lessons_without_guard`, and
  `proofs_hold`: a built phase whose cited test is gone, whose cited test
  failed in its newest recorded run, or whose evidence file is missing. Proof
  lost is named, never fixed by the night: it never steps a phase back.
- **Has the project changed keel's files?** `drift` and `lint`, as
  `keel doctor` reads them (see [When something is red](when-something-is-red.md)).
- **Are the tests healthy?** `flaky_tests` and `slow_tests`, from the test
  ledger (below).
- **Is the work reaching people?** `ci_red_streak`, `machine_prs` (each
  queue against its own bound), `prs_stale`, `phases_without_issue`,
  `reviews_unanswered` (a review comment nobody answered: a reply after the
  reviewer's newest word, or a comment that quotes or links it; resolving
  alone is not one); these read GitHub and are n/a without a `repo` or gh
  auth, saying which, and n/a, never a number, when a read is incomplete.
- **Is the project teaching keel?** `lessons_unsent`: lesson rows not yet
  sent home. The night only counts; sending is the owner's
  ([Lessons and learning](lessons-and-learning.md)).
- **Is rigour paying?** `escapes`: defects found after a phase was built,
  since the last release, attributed to the phase their text names. Its
  bound is no rise release over release. If ceremony rises and escapes do
  not fall, the ceremony is the thing to cut. Its detail also notes the
  `fix:` commits that carry no `Proven-by:` trailer (`keel prove`): a note,
  not counted.
- **Optional rows** appear when their source exists: `build_time` with a
  climb `build` command, `dependency_age` with a lockfile,
  `record_contradictions` with reconciliation on.

### The test ledger, and why a hygiene note is work

On a node project, `npm test` runs a second reporter,
`scripts/keel/test-ledger.mjs`, beside the usual one. It changes nothing
about the run's output. It remembers every run in `.keel/test-runs/` (which
ignores itself) and ends each run with a hygiene block: one line when
clean, else each **flaky** test (passed and failed on one clean tree: a
fact, no threshold) and each **slower** one (well above its own median on
the same kind of machine), with the command that runs it alone. A config
variable's value is never written down: the command takes it from your
shell (`NAME="${NAME:?set NAME as it was in the run}"`), and stops saying
so when it is not set. Each lane (a suite's folder and config) keeps its own
newest runs, so a busy lane never pushes out a quiet one's history.

**Never rerun until green.** A rerun hides the flake, and the next person
pays for it. Fix the test, or file it. The thresholds for "slower" are in
`.keel/keel.json` `tests` (the defaults are in `keel --agent-help improve`).

CI keeps each run's ledger as an artifact, and the night reads them before
it measures, so the history spans every machine the suite ran on. A run that
executed no test exits 1, "no tests ran"; a project with no tests yet sets
`"tests": {"allowEmpty": true}`.

On `bun test` or vitest, the runner writes a JUnit file and the ledger reads
it, as a command right after the tests in the gate. `keel adopt` finds the
runner and proposes the exact line; it never changes the gate itself. The
records, the hygiene block and the "no tests ran" rule are the same, and the
command to run a test alone is the runner's own. Runs of two runners are
never compared with each other.

### A test judges the code, not the machine

A test that waits real time and then checks how long it took passes on a
quiet machine and fails on a busy one. Giving it a longer sleep only makes
every run slower. `keel test` finds such a test by making the machine busy on
purpose:

```bash
keel test tests/acme.test.mjs --stalls            # names each test that judges the wall clock
keel test tests/acme.test.mjs --stalls --seed 42  # the same stalls again
keel test tests/acme.test.mjs --name '^a crate' --stalls
```

It runs the file paused at random moments (the whole process group, 50 to
500 ms, about once a second, from a seed it prints) and again without, and
names each test that passed without and failed with. Paused time does not
count against the time limit. Give a named test its clock (`mock.timers` in
`node:test`, or a clock passed in), then pin the file in `.keel/keel.json`:
`"tests": {"stalls": ["tests/acme.test.mjs"]}`. The test ledger then runs it
with stalls on every gate, from a fresh seed, and a failure prints the seed
and the command that replays it. A test that judges real time on purpose (a
frame rate, playback) can say the machine kept it from judging:
`t.diagnostic('keel:inconclusive <what it measured>')`. The ledger records it
as inconclusive, neither pass nor fail.

## The commands

The night runs itself. You run the same measures by hand when you want to
see them now:

```bash
keel improve            # the measures and the one proposal; writes no page
keel improve --report   # also writes today's health page and .keel/bounds.json
keel improve --selftest # every measure against a fixture built to fail
```

- `keel improve`, bare, when you want the morning's answer before morning.
  It runs the gate, so it takes as long as the gate does.
- `--report` when you want the page itself: it writes
  `<health>/<date>.md`, where `<health>` is `health` in `.keel/keel.json`
  (default `docs/health`).
- `--transcripts <dir>` when you want the cost of conducting: whole-suite
  runs by builders, and minutes per kind of command, from Claude Code
  subagent transcripts.
- `--selftest` when you doubt an instrument: it exits 1 unless every
  measure reports `outside` on keel's own unhealthy fixture.

Without keel installed, the project's own copy runs the same measures:
`node scripts/keel/improve.mjs --report`. What the project cannot read alone
(whether a file is merely behind keel's template, keel's inbox) it reports
as keel-side only, never as zero.

`keel drain <prefix>` is the queue rule by hand: `keel drain keel-night/`
shows what it would merge or close and exits 3; add `--yes` to act.
`--gate-passed` is for the workflow, which passes it only when the gate
passed on the newest PR's tree.

## What you'll see

The night's PR, `keel-night/<date>`, holds the health page and any bound
that tightened. Its body is Summary, Evidence and Merge danger
([Reviews and PRs](reviews-and-prs.md)) with the page's proposal as its
note. Merging it is safe: it is data, and the drain would merge it anyway.

`keel improve` exits:

- **0**: every measure within its bound.
- **1**: one or more outside. Read the proposal.
- **2**: an instrument is broken. Fix the instrument before trusting any
  number beside it.

`keel drain` exits 3 when it would merge or close something and has no
`--yes`, and 1 when a GitHub call failed.

## What it never does

- It never spends model tokens and never needs a secret.
- It never writes to `main`, and never touches a branch outside its own
  prefix or a person's PR.
- It never fixes what it finds: no phase stepped back, no evidence written,
  no lesson sent.
- It never reports a measure it could not take as zero.

## See also

- [When something is red](when-something-is-red.md): a red night, and what
  to do first.
- [Climb and tend](climb-and-tend.md): the passes that act on what the night
  finds.
- [`practices/night/README.md`](../../practices/night/README.md): the
  practice's full argument.

## Where time goes

`keel time --weeks 8` reads the retained ledger; `--json` includes weekly
medians isolated by machine, config and runner, usual times, failure memory,
and missing coverage. Node suite timing is never called full-gate timing.
Keel’s `npm run check` and the night measure the entire configured gate,
without changing its command order. Nested wrappers record only the outer gate. Locally, use
`node scripts/keel/test-ledger.mjs --gate` to record that same boundary.
Do not put this wrapper inside the configured check itself (that recurses).

The wrapper supplies `KEEL_USUAL` before the runner starts: a JSON file in
`.keel/test-runs/usual`, with each test's last-ten-pass median and its lane.
Keel's own runner ordering stays unchanged. Runs with load above cores are
omitted from flaky/slow findings; missing load context is explicitly unknown.
Linux records CPU pressure totals and their delta; other platforms report it
unavailable. Windows load average is unsupported and remains unknown.

New JUnit adoption proposals call the internal `--sample` immediately before
the runner and pass its JSON with `--start` to `--junit`. Sampling failure leaves
the start unavailable and the runner still executes. Existing project gates are
not rewritten; imports without an explicit start remain unknown, even inside a
timed gate, because lint/build time is not the JUnit runner's start context.
The internal `--gate` defaults only when config is absent or a valid object omits
`check`; unreadable or invalid gate configuration stops selection. Timing-storage
failures remain diagnostic and do not block an explicitly selected command.

Locally only, Claude Code's project transcripts provide aggregate counts of
test commands given ≥120-second timeouts, background runs, or interruptions.
Only repo-relative test paths or known test/check script names and counts are
reported, with an unknown-identity bucket. No command text is exported. CI never reads transcripts. Retention can leave
holes in the requested weeks; the report names them rather than inventing
history. See `keel --agent-help time` for the JSON contract.

Gate reports and the board show only root-project gates (`dir: "."`).
Historical subproject gates stay on disk and appear as explicit exclusions.
Transcript counts are null when no valid records were observed in the window;
partial coverage retains observed counts and names omissions.

### Actions usage and reusing CI

`ci_minutes` reads Actions run pages and every retained attempt's job pages.
It rounds each completed job's started-to-completed runtime up to a minute,
excluding queue time, then applies `ci.weights` (defaults Linux 1, Windows 2,
macOS 10, dated 2026-10-09). These are configurable usage weights, **not an
invoice or a universal tariff**. `ci.runnerWeights` can supply explicit weights
for custom runner labels. Reports separate public standard-hosted free usage,
self-hosted usage, private plan-dependent billing, larger/custom runners and
unknown runner coverage. Free billing does not erase compute usage. Workflow
ownership comes from `.keel/lock.json` paths, including managed `check.yml` and
`claude.yml`; an unowned `keel-*` name is labeled keel-named, not keel-owned.
Direct `readCiUsage` callers can pass `ownedWorkflows` paths explicitly.

Set `"ci": { "weeklyMinutes": 1000 }` to choose a weekly bound; without one
usage is reported without a budget verdict. The seven-day window attributes
jobs by completion time and includes their full runtime, including failed and
canceled jobs. Positively queued/in-progress jobs are outside this completed-job
window: reports count their exclusion and leave unfinished usage unestimated,
never a full in-flight billing total. An authoritative empty job list for the
current queued attempt is counted separately as an exclusion; older attempts
still require observable jobs. Empty completed attempts remain unknown.
Future completion timestamps and malformed
completed-job timing remain unknown. API errors, missing
attempts and unknown labels are gaps, never free zero usage. Observed usage
already above a bound remains a finding even when the total is incomplete.

The read is bounded to 5 run pages, 5 job pages per attempt, 100 items per page,
10 attempts per run and 200 requests. Run history is not cut off by creation
age: an old run can have a new rerun. A long-lived repository or workflow can
exhaust that lifetime-history bound even when recent runs are visible. Its
weekly total and adoption estimate remain unknown; the report retains observed
usage and names the limits. The production reader is exported as `readCiUsage`
from `scripts/keel/ci.mjs` for read-only API walks.

`ci.gateWorkflow` names the existing workflow to reuse. The top-level
`gateWorkflow` alias still works; conflicting values are an error. Discovery
heuristics do not authorize reuse. The gate measure reuses only same-repo,
default-branch **push** CI on the exact clean SHA. PR and fork runs are excluded.
The newest candidate by update/attempt freshness must be completed success or
failure, with validated matching jobs completed within 24 hours. A completed
failure remains a failure; pending, skipped, canceled, stale or unavailable
results fall back to the configured local command. Reused reports name the
source, SHA, conclusion and completion age. They do not claim local execution
or create local gate wall-time records. Keel's own real reuse walk must follow
merge and default-branch CI, not just a green PR check.

Both adoption paths preview only workflows they would create, with triggers,
history source/window and monthly weighted-minute estimates. They query the
same production reader for each workflow's history in `dalmaer/keel` (override
with `ci.historyRepo`). Daily/weekly scheduled runs use the proposed schedule
and observed mean cost including retries. Completed logical runs whose jobs
are all positively skipped at known in-window times supply zero-cost samples;
empty job lists and undated skips do not establish such a sample. Logical runs with unfinished latest
attempts, out-of-window non-skipped jobs, or incomplete job reads are excluded
in their entirety from adoption samples, including
earlier completed attempts; their completed jobs still count in window usage.
Cached attempt rows require explicit boolean `runComplete` provenance and
`assumptions.logicalRunBasis` matching the reader; older caches must be
refreshed. Whole-run eligibility requires all non-skipped jobs across all
attempts to contribute, even when an excluded attempt has no in-window rows. Other events use the source's
observed event rate scaled to 30 days, **not a nightly frequency**. Target
activity may differ. Estimates reuse source per-run runtime: target setup, gate
and runtime may differ too. This is not a benchmark of the new project.
Requested history and observed exposure are separate:
`window.observedSince` is the latest of requested start, repository creation,
and workflow creation for per-workflow history. The reader fetches workflow
metadata separately and records `window.workflowPath` and
`window.workflowCreatedAt`; fractional `observedDays` as the event-rate denominator.
Quiet days count; the first returned run does not set exposure. Missing or
invalid repository or workflow age makes event projections unknown, while a schedule-only
mean × cadence estimate remains possible. Cached exposure must match these
dates, workflow identity, and arithmetic. Repository-wide cached history cannot
supply workflow event exposure. Unsupported schedules or incomplete/missing history yield
unknown estimates and an unknown total. Preview installs no schedules.

For offline preview, `.keel/ci-history.json` may hold
`{ "version": 1, "repo": "owner/repo", "workflows": { ".github/workflows/check.yml": REPORT } }`,
where each `REPORT` is an unmodified `readCiUsage({repo, workflow: 'check.yml', days: 28})`
result. Cache windows must match their day count, end within the past 30 days,
and use the current weight maps; malformed or stale caches are discarded.
`KEEL_CI_OFFLINE=1` prevents remote history reads. No estimate is a claim about
actual monthly billing; the metered-project month comparison remains required.
