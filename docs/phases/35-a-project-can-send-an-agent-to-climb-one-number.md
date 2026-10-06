---
status: planned
since: 2026-10-06
goal: G4
spec: 2
depends: [10, 15, 33, 39]
note: "The 6 Oct hill-climb (suite 48s → 23s) as a repeatable, opt-in night: one shared protocol, one job a night within a budget, one PR a person merges. First job: test-time, on keel. Design: research/2026-10-06-climb-nights.md."
evidence: []
issue: 13
---

# A project can send an agent to climb one number overnight, and only a person merges what it finds

## Done when

A project that opts in (keel first) gets, on a scheduled night, one `keel-climb/test-time/<date>` PR made by an agent under the shared protocol: a baseline, kept changes each with numbers measured against noise, a list of what was tried and reverted, the gate green; or, when nothing beat the noise, no PR and a line on the health page saying so. Nothing it opens merges without a person.

## Scope

The design is [Climb nights](../research/2026-10-06-climb-nights.md).

- **The `climb` practice** (optional, off by default): ships
  `.github/workflows/keel-climb.yml`, `scripts/keel/climb.mjs` and the brief
  `.agents/climb/PROTOCOL.md` with the job paragraphs. Needs the `claude`
  practice's secret, declared the same way; until it is set, the run ends
  green with a notice (as the night does for a missing secret).
- **Config**: `"climb": { "jobs": [...], "budget": { "minutes": N }, "schedule": "nightly"|"weekly" }`
  in `.keel/keel.json`, validated; no key, no climb.
- **`scripts/keel/climb.mjs`**, deterministic, no model:
  - `pick` chooses tonight's job: the job tied to the health page's worst
    measure, else the next in rotation; a job with an open `keel-climb/<job>/`
    PR is skipped.
  - `measure <job>` prints the job's number as median and spread over k
    runs.
  - `compare <base> <candidate>` runs base and candidate alternately for two
    rounds, and says keep or revert against the margin.
  - `guard` runs the gate and checks no test was dropped (phase 33's ledger:
    the same test names ran).
  - `report` writes the PR body and the health-page line.
- **The workflow**: checkout, setup (config `setup`, as the night),
  `climb.mjs pick`, then `anthropics/claude-code-action` with the brief and
  the picked job, time-boxed to the budget; the agent uses `climb.mjs` for
  every measurement and every keep-or-revert, so its numbers are the
  script's, not its own. Then the PR, on its own prefix only.
- **Its PR body** comes from `scripts/keel/pr-body.mjs` (phase 39): Summary, Evidence (the before-and-after), Merge danger.
- **The first job, `test-time`**: the gate's test command timed; with the
  ledger, the slowest files first.

## Acceptance

- [ ] `climb.mjs pick` chooses the job tied to the worst measure, rotates when none is outside its bound, and skips a job with an open PR. `tests/climb.test.mjs: "pick"`
- [ ] `climb.mjs compare` on a synthetic slow and fast candidate says keep for a real gain and revert for one inside the noise; mutation: a single round instead of two fails the test. `tests/climb.test.mjs: "compare"`
- [ ] `climb.mjs guard` fails when a test name that ran in the base did not run in the candidate. `tests/climb.test.mjs: "guard"`
- [ ] `keel-climb.yml` keeps the night's rules: pushes only `keel-climb/`, never `main`, never merges, declared secrets only, and its shell and inline scripts pass `bash -n` and `node --check`. `tests/workflows.test.mjs`
- [ ] With no secret set, the run ends green with a notice; with no `climb` key, the workflow does nothing. `tests/climb.test.mjs: "off"`
- [ ] ⚑ by hand: the owner turns climb on for keel, a scheduled night opens a test-time PR (or reports it kept nothing), and the owner reads it and merges or closes it.

## Real surfaces

- Workflow shell: `keel-climb.yml` on GitHub Actions, run for real on keel.
- GitHub API: the PR it opens, on its own prefix.
- Adopted project: none in this phase (keel only); phase 37 takes it to ledger.

## Proof

- Automated: `node --test tests/climb.test.mjs tests/workflows.test.mjs`, with the mutation above; `npm run check`.
- By hand: one real climb night on keel, its PR (or its "kept nothing" line) read by the conductor and the owner.
- ⚑ Turning climb on for keel spends model tokens each scheduled night, within the configured minutes; the owner sets the budget.

## Deliberately open

- **Tokens as the budget's unit**, if the action reports them; minutes until then.
- **More than one job a night.** One, until a week of climb nights shows the PR load.

## Next action

Write `scripts/keel/climb.mjs compare` (alternated rounds, margin, keep or revert) and its test against a synthetic slow and fast command.
