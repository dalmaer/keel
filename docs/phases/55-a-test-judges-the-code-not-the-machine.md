---
status: planned
since: 2026-10-09
goal: G0
spec: 2
depends: [33]
note: "keel 'fixed' a flaky climb test by raising its sleep from 600 to 1500 ms and the timing floor from 300 to 1000 ms: still a wall-clock test, only slower. keel test --stalls pauses a test's process group at seeded random moments and names the tests that judge the wall clock; they move to mock timers, and the timing rule becomes 'with stalls or mock timers', not 'sleep longer'. Design: research/2026-10-09-robot-and-time.md (phase 55)."
evidence: []
issue: 42
---

# A test judges the code, not the machine

## Done when

`keel test <file> --stalls` names every test that passes plainly and fails when paused at random moments; keel's own tests it names have moved to mock timers or an injected clock, and run with stalls without failing; the timing-hygiene rule says "with stalls or mock timers" instead of a sleep floor; and the practice ships it to the fleet.

## Scope

The design is [The robot, and keel's sense of time](../research/2026-10-09-robot-and-time.md), phase 55.

- **Stalls**: `keel test <file> [--name <pattern>] --stalls [--seed N]` runs the file in its own process group and, at random moments from a printed seed (about once a second, never two seconds apart), pauses the whole group with SIGSTOP for 50 to 500 ms, then SIGCONT. Paused time does not count against the test's timeout. It then runs the same files without stalls (or uses a pass from the ledger on the same tree within a day), and names each test that passed without and failed with: it judges the wall clock. `--seed N` replays the same stalls.
- **Pinned**: `.keel/keel.json` `"tests": { "stalls": ["<file>"] }` runs those files with stalls on every gate, from a fresh seed each time, which a failure prints.
- **Inconclusive**: a test that judges real time on purpose can report itself inconclusive (`t.diagnostic('keel:inconclusive <what it measured>')`); the ledger records it as neither pass nor fail.
- **keel's own tests**: every test `--stalls` names in keel moves to `mock.timers` or an injected clock; the climb comparison test's 1500 ms sleeper is the first.
- **The rule**: tests/timing-hygiene.test.mjs (and the practice's lint) stops requiring a sleep of at least 1000 ms and requires that a test using a timing sleep is pinned to stalls or uses mock timers.

## Acceptance

- [ ] `--stalls` pauses the test's whole process group (children too) at seeded moments; the same seed gives the same stalls; paused time is not counted against the timeout. `tests/stalls.test.mjs`
- [ ] A synthetic wall-clock test (a 100 ms deadline on a 50 ms wait) passes plainly and is named under stalls; the same test under `mock.timers` passes both. `tests/stalls.test.mjs`
- [ ] A file pinned in `"tests": { "stalls": [...] }` runs with stalls in the gate and a failure prints its seed. `tests/stalls.test.mjs`
- [ ] An inconclusive diagnostic is recorded as inconclusive, never pass or fail. `tests/test-ledger.test.mjs`
- [ ] keel's own suite has no test `--stalls` names, and its timing tests are pinned to stalls. `tests/timing-hygiene.test.mjs`
- [ ] ⚑ by hand: the owner reads the list of tests that moved and the gate's time before and after.

## Your part

- **Ask:** Read which of keel's tests turned out to depend on the machine's speed, and whether the gate got faster once they stopped waiting on real time.
- **Why:** It decides whether the rule ships to the fleet's projects as it is.
- **Look at:** This phase's evidence: the tests that moved, and the gate's time before and after.
- **Choices:** Ship it to the fleet | Ship it as advice only | Keep it in keel
- **Takes:** 10 minutes.
- **Then:** Ship it: the rule goes out in the next release, and the night names wall-clock tests in each project. Advice only: the rule is a note, never a failure. Keep it in keel: nothing ships.
- **Ready when:** keel's own timing tests have moved.

## Real surfaces

- Owner's machine: `keel test --stalls` on macOS.
- Workflow shell: the gate on GitHub Actions (Linux), with pinned files running with stalls.

## Proof

Automated: `node --test tests/stalls.test.mjs tests/test-ledger.test.mjs tests/timing-hygiene.test.mjs`; `npm run check`.
By hand: keel's gate time before and after, from the ledger.

## Deliberately open

- **Stalls in the default gate**: off, except for pinned files. Settled by how long pinned files add.
- **A test that is inconclusive most of the time** has gone unjudged; phase 57's measure names it.

## Next action

Brief a builder on `keel test --stalls` and run it over keel's own suite.
