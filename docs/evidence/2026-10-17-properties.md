# Evidence: phase 85 — properties guard keel's plan, tick and claim code

- Date: 2026-10-17
- Phase: [85](../phases/85-properties-guard-plates-s-plan-tick-and-claim-code.md)
- Revision: base `b8b86c6` (main, phase 80 merged) and working tree on
  `claude/phase-85`.
- Claim being checked: a seeded, shrinking, zero-dependency property runner
  lives in `tests/helpers/property.mjs`; properties over the night plan's
  validator, tick merging, claims and phase front matter run in the gate;
  each failure is reported as its smallest case and the seed that reproduces
  it; each property fails on a planted bug of its kind.

No network, no real project: plans and phase files are generated, and the
claim property races clones of a synthetic Acme bare origin in a temp
directory, with gh a stub listing no PRs.

## What was built

- `tests/helpers/property.mjs`: mulberry32 PRNG; generators `int`, `string`,
  `element`, `constant`, `array`, `tuple`, `record`, `oneOf`, `optional`,
  `map`, `date` (real calendar days), `impossibleDate` (month 00 or 13–99,
  day 00, a day past its month's last), `permutation`; lazy shrink trees, so
  `map` and `record` shrink through what they are built from; greedy
  shrinking; `check` (a verdict) and `property` (throws the report).
  `KEEL_PROPERTY_SEED` sets the run's seed (default: one fresh seed per
  process, printed on failure); `KEEL_PROPERTY_RUNS` sets every property's
  count, divided by a costly property's `cost`.
- `tests/properties.test.mjs`: the properties, each written over its subject
  so the same property also runs against planted bugs in the test itself.
- `furthestItems` (practices/night/files/scripts/keel/morning.mjs): finalPlan's
  furthest-tick merge pulled out as a pure, exported function, behaviour
  unchanged (`tests/morning.test.mjs` passes), so the property drives the
  merge itself rather than through git.
- `package.json`'s test script also runs `tests/helpers/*.test.mjs`, so the
  runner's own test is in the gate.

## Real bugs found

Both were found by the properties on their first run, before any fix, and
reproduce with `KEEL_PROPERTY_SEED=283816414`:

1. **The plan validator accepted a readyBy on an impossible day.** Property
   "every fault is refused" (`tests/properties.test.mjs`), smallest case:
   an empty plan with `readyBy: '2000-01-32T07:00:00Z'` (22 shrinks). The
   validator checked readyBy's shape only. `Date.parse` reads that time as
   NaN, so `readiness` never sees it pass: with a build still open, the
   night is never over by readyBy and the morning never sends (checked:
   `readiness({ readyBy: '2026-10-32T07:00:00Z', items: [an open build] },
   2027-01-01).ready` is `false`). `2026-02-30T07:00:00Z` was accepted too
   and read as 2 March. Fixed in its own commit, `fix: the plan validator refuses a readyBy on an impossible day` (`isReadyBy`: the day a real
   day, hours, minutes, seconds and zone in range), with its regression in
   `tests/night-plan.test.mjs`; `keel prove` VERIFIED.
2. **A phase whose `since` names an impossible day threw a bare RangeError.**
   Property "an impossible date is refused by name", smallest case: a planned
   phase with `since: 2000-01-32` (39 shrinks), which threw `RangeError
   "Invalid time value"` with no file named, where the roadmap means
   `<file>: invalid since date`. Fixed in its own commit, `fix: an impossible since date is refused naming
   the file, never thrown as a bare RangeError` (the module's `isDate`, which `after` already used), with its regression in
   `tests/roadmap.test.mjs`; `keel prove` VERIFIED.

Both fixes are a line or two and obvious from the shrunk case.

## Automated checks

The phase's Proof, by file:
`node --import ./tests/helpers/hermetic.mjs --test tests/helpers/property.test.mjs tests/properties.test.mjs`:
15 tests, all pass, exit 0, about 2.8 s wall (the claim properties are about
3.3 s of it, run concurrently with the rest). Run 30 times in a row for the
pure properties and their planted-bug tests (fresh seeds each time) and 5
times for the claim properties: all passed. Also by file, all exit 0:
`tests/night-plan.test.mjs`, `tests/morning.test.mjs`,
`tests/roadmap.test.mjs`.

| Property | Test |
| --- | --- |
| a failure shrinks to its smallest case (37, `[50]`, `'y'`, `{ a: 11, b: 'q', c: null }`) | `tests/helpers/property.test.mjs` |
| the same seed, the same inputs and shrunk case; the report names the seed; a fresh process with `KEEL_PROPERTY_SEED` prints the same report | `tests/helpers/property.test.mjs` |
| accepted plans round-trip through writePlan/readPlan and writeRecord/readPlan (60 inputs) | `tests/properties.test.mjs` |
| a sixth build, a build with no number, an impossible date (plan date or readyBy), an unknown field (plan, item, number, budget, result; including `__proto__` and `constructor`) is refused by name, never thrown on (200); any JSON value in any field is a verdict, never a throw (200) | `tests/properties.test.mjs` |
| a tick twice is a tick once (200); over any run of ticks done never moves back, every refusal is a NightPlanError, and the plan stays valid (150) | `tests/properties.test.mjs` |
| the furthest tick wins in any order of the places read (300) | `tests/properties.test.mjs` |
| of 2–4 racers in one bare origin, with random push delays and frozen or live clocks, exactly one holds, the origin holds its commit, every other is refused naming it (3 races) | `tests/properties.test.mjs` |
| parse after render is identity for every field the roadmap accepts, in any order, bare or quoted, each line written by keel's own `setField` (300) | `tests/properties.test.mjs` |
| an impossible since or after is refused naming the file (100) | `tests/properties.test.mjs` |

### Planted bugs

In the test file (kept, run in the gate: each must be caught, with a small
shrunk case): the validator accepting an impossible date, accepting an
unknown field, letting a sixth build through; a tick that lets done move
back, a tick that is not idempotent (its note appended); a merge where the
last place wins, a merge where running outranks done; a claim that believes
any claim on the branch is its own; a front-matter parser that trims values,
one that keeps a quoted note's quotes.

In the source, by hand (each planted, the property tests run with
`KEEL_PROPERTY_SEED=283816414`, the file restored; a script in the session's
scratchpad did the plant and restore):

| Planted in | Bug | Caught by | Smallest case |
| --- | --- | --- | --- |
| night-plan.mjs `isDate` | returns true for any YYYY-MM-DD shape | every fault is refused | `date: '2000-13-01'`, empty plan (21 shrinks) |
| morning.mjs `furthestItems` | the last place read wins | the furthest tick wins in any order | one item, places running then planned: "the furthest tick (running, planned) is planned" |
| roadmap.mjs `parsePhase` | a quoted value read by stripping its quotes, not as JSON | parse after render is identity | `goal: 'G"'` (26 shrinks) |
| claim.mjs `claim` | `winner?.token === token` loosened to `winner` | exactly one racer holds | two racers, both claude on acme-laptop, delay 0: `[true,true]` (6 shrinks) |
| claim.mjs `claim` | the create-only lease replaced by `--force` | exactly one racer holds | two racers, delays 0 and 20 ms: `[true,true]` (9 shrinks) |

The `--force` plant first survived: with push delays of 0–25 ms every racer
pushed before any read back, so the last push won and only one saw its own
token. Widening the delays to 0–120 ms (pushes that land after another
racer's read-back) made the property catch it; the gate runs the wider range.

## Gate cost

Measured 2026-10-17 on the owner's machine, with a scratch script that runs
the suite as `npm test` does (`node --import ./tests/helpers/hermetic.mjs
--test --test-concurrency=32`), alternating without and with the two new
files, two rounds: without 112.7 s and 122.2 s; with 112.8 s and 117.8 s.
The added wall time is inside the run-to-run noise (about ±5 s): the two
files take about 2.8 s by themselves (the claim races about 3.3 s of test
time, the pure properties under 0.5 s) and run concurrently with the slower
files. `KEEL_PROPERTY_RUNS=<n>` raises every count (a claim race's by n/25)
for a longer run off the gate.

The whole gate, `npm run check`, on the integrated tree (both fixes and this
phase): rc=0, 1759 tests, 0 failed, the roadmap, render and inbox checks
current; about 410 s wall on a busy machine.

## Gaps and decision

- Ties between two different terminal statuses (done in one place, failed in
  another) go to the earlier place by finalPlan's documented order; the merge
  property checks that the furthest *rank* is order-free, and the exact item
  only where one value holds the furthest rank. That is the design, not a
  bug.
- Front matter: a JSON string holding U+2028 or U+2029 is refused (the
  metadata line pattern's `.` does not match them, and `JSON.stringify` does
  not escape them). No keel writer writes one; the generators leave them out
  and the limit is recorded here.
- The shrinker is greedy and positional: the merge case shrinks to one item
  but not always to two places, since a late place cannot move earlier.
- The ⚑ box stays open: the owner reads one shrunk failure. The two real
  bugs above are that failure.

Supports `partial`, owing the walk.
