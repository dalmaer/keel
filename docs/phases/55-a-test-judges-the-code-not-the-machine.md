---
status: partial
owes: walk
since: 2026-10-09
goal: G0
spec: 2
depends: [33]
note: "Built: keel test <file> --stalls (scripts/keel/stalls.mjs, shipped by the night practice); files pinned in tests.stalls run with stalls through the test ledger in every gate; keel:inconclusive is recorded as neither pass nor fail; keel's three climb compare tests run on the suite's own clock (KEEL_CLIMB_CLOCK), and its six suite-timing files are pinned. Owes the owner's read of what moved and the gate's time before and after."
evidence: ["evidence/2026-10-09-stalls.md"]
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

- [x] `--stalls` pauses the test's whole process group (children too) at seeded moments; the same seed gives the same stalls; paused time is not counted against the timeout. `tests/stalls.test.mjs`
- [x] A synthetic wall-clock test (a 100 ms deadline on a 50 ms wait) passes plainly and is named under stalls; the same test under `mock.timers` passes both. `tests/stalls.test.mjs`
- [x] A file pinned in `"tests": { "stalls": [...] }` runs with stalls in the gate and a failure prints its seed. `tests/stalls.test.mjs`
- [x] An inconclusive diagnostic is recorded as inconclusive, never pass or fail. `tests/test-ledger.test.mjs`
- [x] keel's own suite has no test `--stalls` names, and its timing tests are pinned to stalls. `tests/timing-hygiene.test.mjs`
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

⚑ The owner reads which of keel's tests moved and the gate's time before and after (this phase's evidence), and picks: ship the rule to the fleet, advice only, or keep it in keel.

## Trajectory

- **2026-10-09** — `keel test` did not exist; it is a new verb (`lib/test.mjs`), and its engine is `scripts/keel/stalls.mjs` in the night practice, beside the ledger, so a project's gate runs it from its own repo.
- **2026-10-09** — Pinned files run through the test ledger, not the test script: every node project already loads the ledger (`keel init`, migration 0004), so a pin is one line of `.keel/keel.json` and no migration rewrites anyone's `scripts.test`. The ledger starts a pinned file's stalled run once that file's own run is over (PR #57's review: two copies at once share ports and fixtures), while the rest of the suite goes on, from one fresh seed per run; a narrowed run starts none. It imports `stalls.mjs` only when something is pinned, so a copy of `test-ledger.mjs` alone keeps working.
- **2026-10-09** — Paused time is kept out of the limit by running `node --test` with no timeout of its own and keeping one of running time (30 minutes). A test's own `{ timeout }` still judges the wall clock, which is what stalls should catch.
- **2026-10-09** — `keel test --stalls` over the base commit's climb compare tests named none: at their 1500 ms base (seeds 55, 1, 2, 3) and at their old 600 ms base (seeds 1, 2, 3). A stall about once a second slows base and candidate in proportion, and the 30% margin holds. Stalls catch a fixed deadline, not a ratio with a wide margin, and not node's start-up cost, which failed CI in 9734581. The tests moved anyway: they judge the wall clock by construction, and every gate paid for their sleeps.
- **2026-10-09** — Per test: `compare: keep for a real gain…` and `compare --decide, revert, settle and report…` (tests/climb.test.mjs) and `phase 47: under KEEL_AGENT_GIT…` (tests/climb-codex.test.mjs) moved to injected durations. climb.mjs's measure reads the time the suite writes to `KEEL_CLIMB_CLOCK` (a test seam, like `KEEL_GH`) in place of the wall clock, and the fixtures wait no real time. The decide test keeps one real, unjudged wall-clock baseline. None reports inconclusive: what they judge is compare's decision, whose input is a duration, so the duration moved into the fixture. All six files that run climb compare or measure (climb, climb-codex, climb-guard, climb-hygiene, climb-pick, climb-tend) are pinned to stalls; with stalls (seed 55) they named none.
- **2026-10-09** — There is no practice lint for timing hygiene yet; the rule lives in `tests/timing-hygiene.test.mjs`. Shipping it to the fleet is the owner's choice in Your part.
- **2026-10-09** — Codex's review of PR #57 found three gaps, each fixed with a test: SIGINT or SIGTERM during a stall left the test's group stopped (node emits no `exit` on a signal), so stalls.mjs now ends and resumes the group on either; a ledger baseline was taken from any config or folder, so it must now match the run's lane; and an inconclusive run without stalls counted as a pass, so it is now `unbased`, never named.
- **2026-10-09** — Codex's second review of PR #57 found five more, each fixed with a test: a pinned file's stalled copy ran beside its own original (now after it); one bad `tests.stalls` entry disabled every pin quietly (now the good ones run and the bad one fails the run); a run without stalls that died counted as clean; `keel test` from a workspace ran at the project's root with the root's preloads (now from the nearest package.json folder); and the command's own exit left the group running. Replay commands quote each file.
- **2026-10-09** — Codex's third review of PR #57 found five more, each fixed with a test: a ledger pass from another node, OS or architecture stood in for a plain run; a quoted preload path with a space was dropped; the suite's other node flags (`--conditions`, `--test-global-setup`) were not carried to the stalled run; a run that executed no test exited 0; and two tests of one name were judged against each other's plain run.
- **2026-10-09** — Codex's fourth review of PR #57: a pin to a file that is gone was silently inactive, and a pinned run no stall landed in said "passed with 0 stalls". A gone pin now fails the run (a pin the run did not reach is only left alone: a run of some files is not a broken pin). A run with no stall reruns once with its first stall inside half its running time, and if none lands again it is inconclusive and fails; one rerun, never a loop. The file-wide mock.timers exemption in timing-hygiene is tracked.
