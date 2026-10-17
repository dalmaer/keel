# Evidence: phase 86 — a whole night runs in one test

- Date: 2026-10-17
- Phase: [86](../phases/86-a-whole-night-runs-in-one-test.md)
- Revision: base `b8b86c6` (Merge pull request #178, phase 80) and working
  tree on `claude/phase-86`.
- Claim being checked: one test runs a night end to end (the owner's plan, the
  night's plan step and measure, a climb pass that ticks its item, the
  morning's decide, finalize and send, and the plan card) and the brief and
  the card say what happened; breaking any one stage fails it, naming the
  stage; it runs in under 30 seconds with no network.

No real project and no network: Acme Anvils is synthetic, its origin a bare
repo in a temp directory, GitHub a stub gh with a state file
(`tests/helpers/night-box-gh.mjs`), the canvas the fake isocan home
(`tests/helpers/isocan.mjs`), and every node a step starts loads
`tests/helpers/night-box-preload.mjs`: a frozen clock and no socket, DNS
lookup or fetch. No model runs and no token is spent.

## The night the test runs

| When (UTC) | What runs | Its own code |
| --- | --- | --- |
| 10-04 21:30 | the owner: `keel goodnight`, drop the persona's triage item, add a build-time build and a robot build, `--yes` | `lib/goodnight.mjs`, in-process with `now` |
| 10-05 07:23 | keel-night: Plan the night, Measure, Open the night's pull request | keel-night.yml's shell; `night-plan.mjs tonight`, `improve.mjs --report`, `night-plan.mjs publish` |
| 07:41 | keel-morning after the night: decide (not over), the card (made) | keel-morning.yml's shell; `publishPlanCard` |
| 10:17 | keel-climb: Read tonight's plan, Pick tonight's job, Tick tonight's plan | keel-climb.yml's shell; `climb.mjs pick --plan`, `passTicks`, `night-plan.mjs record` |
| 11:52 | keel-morning after climb: decide (not over), the card (edited in place) | as above |
| 17:07 | keel-morning's cron: decide (over at readyBy), finalize, send, the card (unchanged) | keel-morning.yml's shell; `morning.mjs decide`, `finalize`, `send` |
| 10-06 03:10 | keel-morning once more, and the 17:07 send job re-run by hand | decide reads the night of 10-05 as sent; send's own check holds |

The night ends with one item of each kind the brief sorts: climb's
`climb-test-time` done with its PR (#21), the night's `measures` failed (the
build is broken tonight, so `build_time` is a broken instrument), climb's
`climb-build-time` skipped (one job a night), and the robot's `robot-12` not
finished by readyBy (the robot does not run in the box).

## Automated checks

`node --import ./tests/helpers/hermetic.mjs --test tests/night-box.test.mjs`
(the phase's Proof): 2 tests, both pass, exit 0. The whole gate,
`npm run check`, runs on the integrated tree before the commit; its result
line is in the commit body.

| Acceptance box | Test |
| --- | --- |
| 1. one done, one failed, one unfinished: each in the right section with its link or reason | `tests/night-box.test.mjs` "a whole night: …": the sent issue's body is read section by section (isocan's order; Done holds `climb-test-time` with its note and PR link; Failed, and why holds `measures` with "1 broken (build_time)"; Not finished by 2026-10-05T17:00:00Z holds `robot-12`, still planned; Left alone holds `climb-build-time` with climb's reason; the canvas and health page links; Your next) |
| 2. exactly one morning issue; the card's last version shows each item's final status | the same test: one "Good morning, 2026-10-05" issue, assigned and labelled, yesterday's closed; a later run and a re-run send job send nothing; the card's last version equals `planCard` of the final record, the fake home holds exactly those bytes, and it has two versions (the night, climb's tick) |
| 3. breaking any one stage fails it, naming the stage | "breaking any one stage …": the plan write, the tick, finalize and send each broken in the fixture's copy of its managed script, and the card's write kept from the canvas; each night fails with `[plan]`, `[tick]`, `[finalize]`, `[send]`, `[card]` |
| 4. under 30 seconds, no network | the first test: the preload refuses the network in every node the steps start (a probe through the same environment is refused, naming `github.com:443`); the time is asserted at the machine's quiet pace (below) |
| 5. ⚑ by hand | Not run: the owner's look at the test in CI. |

### The stages it names when broken (2026-10-17)

From the second test's diagnostics:

| Broken | The night fails with |
| --- | --- |
| plan: the night's `tonight` never writes the branch's plan | `[plan] the night wrote tonight's plan to .keel/night/plan.json before anything ran` |
| tick: climb's tick never says done | `[tick] climb ticked its item done on the plan branch: … climb-test-time running → failed` |
| finalize: the record is named but not written | `[finalize] the record holds each item's final outcome` |
| send: the already-sent check compares the wrong way | `[send] one brief for the night` |
| card: the card's write never reaches the canvas | `[card] the canvas has the plan card` |

### Each guard the night relies on, broken in keel's own source

`scratchpad/mutate.mjs` (not committed): one mutation at a time in this
worktree's source, the night test run
(`node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern="a whole night" tests/night-box.test.mjs`),
the file restored; `git status` showed only this phase's files afterwards.

| Mutation | Result |
| --- | --- |
| `finalPlan` takes each item's lowest tick, not its furthest (`morning.mjs`) | exit 1: `[card] the card shows the night's measure item failed` |
| the night is never over at readyBy (`readiness`) | exit 1: `[finalize] over at readyBy, not yet sent` |
| send closes the closed briefs, not the open one | exit 1: `[send] yesterday's brief is closed` |
| send's own already-sent check is dropped | exit 1: `[send]` the re-run send job sends again |
| the brief's Failed lists only build items | exit 1: the brief's count line no longer says "1 failed" |
| a broken instrument still ticks the measure item done (`tickMeasures`) | exit 1: `[measure] a broken instrument fails the measure item` |
| a tick drops its link (`applyTick`) | exit 1: `[tick] with its PR` |
| `nightOf` keeps an evening plan on today's date | exit 1: `[plan] the evening shapes the next night` |
| climb skips none of the plan's other climb items (`choosePlanned`) | exit 1: `[tick] the other climb item is skipped: one job a night` |
| the morning's `lastNight` never steps back before 07:23 UTC | exit 1: `[send] decide reads the brief as sent` (first run: this one survived; the last morning moved to 03:10 UTC the next day, after midnight and before the next night, and it is caught) |
| the plan card carries no rows (`planCard`, `lib/morning.mjs`) | exit 1: `[card] the card shows the night's measure item failed` |
| keel-climb.yml's tick links `/pulls/` for the PR | exit 1: `[tick] with its PR` |
| keel-morning.yml's decide writes no outputs | exit 1: `[card] the night is not over` |

13 of 13 caught on the final test.

### Time, measured

| Run | Load average (1 min) | Raw | At the quiet pace |
| --- | --- | --- | --- |
| the first test alone | not recorded | 6.8 s | (before the pace sample) |
| alone | ~50 | 7.9 s | (before the pace sample) |
| alone | ~221 | 31.9 s | 6.5 s (×4.9) |
| in `npm test`, 32 files at once | 215 → 73 | 30.6 s (34.9 s with its sampling) | 7.1 s (×4.3) |

The box is processes and nothing that waits (no sleep, no poll, no timeout
reached), so its time scales with the machine's load. Another session's work
held this machine's load average between 50 and 230 all afternoon, which made
the same night 7 to 32 seconds. A raw 30-second assertion would fail the gate
on a busy machine (lesson 40), so the test takes a pace sample (ten node
starts with the preload and ten gits) either side of the night and divides
the night's time by the load it shows against `QUIET_PACE_MS` (400 ms). It
prints both. The machine was never idle today, so 400 ms is the fastest the
sample ran, not an idle measurement: five samples ran 1305 to 3145 ms in one
run and 380 to 507 ms in another a few minutes later (on a 14-core laptop;
the load average did not predict which). The normalized times (6.5 s, 7.1 s)
agree with the raw 6.8 s of the first run. Sample it again on an idle machine
and set the constant from that.

The gate: `npm test` took 263 s wall (218 s of tests, 1743 tests) before this
phase and 236 s (181 s, 1745 tests) with it, at different loads, so the added
wall time is within the noise. The new file used 90 s of one of the 32
workers under that load: the night 35 s, the five broken nights 55 s. At the
quiet pace that is about 7 s and 20 s.

## By hand

| Did | Expected | Observed | Proves / does not prove |
| --- | --- | --- | --- |
| Read the sent brief and the card's last version (dumped once from the test) | each item where the owner would look for it | as the table above; the health link is the morning's own branch `keel-night/2026-10-05-final`, since neither night PR is merged | that the oracle's strings are what the brief says; not how an owner reads it |
| The owner looks at the test in CI | | Not run | the ⚑ walk |

## Findings

No bug in the night's code turned up: every stage did what its phase says,
on the first run that got past the fixture. What the box showed instead:

- A persona's missed goal can never be a build. Its number is
  `persona:<name>:<goal>`, and no climb job measures one (climb's jobs measure
  `slow_tests`, `flaky_tests`, `build_time`, `perf` and the proposals rows), so
  `handBuild` and goodnight always make it triage. Phase 78's "a persona build
  goes to the climb job that measures its number" is unreachable as climb's
  jobs stand.
- `keel goodnight add --lane robot:#12` accepts an issue number that nothing
  checks: no keel:agent issue #12 existed in the box, and the plan was
  accepted. Whether the robot then refuses it was not run here (the robot is
  not in the box); in the box the item stays planned until readyBy.
- The brief's health link points at a branch (`keel-night/<date>-final` or
  `keel-night/<date>`) while those PRs are unmerged, as keel#149 chose. Once
  the drain merges them and the branch is deleted, the link in the email 404s.

Each is for the owner to decide; none is changed here.

## Gaps and decision

- Simulated, not run: GitHub's scheduling (the test asserts the `if:` text it
  simulates), artifacts between jobs, climb's agent and judge, and the card's
  CI provisioning (pinned keel and isocan, the journal restore, which
  `tests/morning.test.mjs` covers). The card publishes through keel's own
  `publishPlanCard` from the owner's checkout, where the fake home's manifest
  lives.
- The robot and Loop are not in the box (phase 54).
- `QUIET_PACE_MS` is an estimate, not an idle-machine measurement (above).

Supports `partial` with the walk owed: every buildable box is checked by a
test that ran, and the ⚑ box is the owner's look.
