---
status: planned
since: 2026-10-06
goal: G4
depends: [10, 11]
note: "The owner's example: after a test run, the agent hears 'this test is flaky over the last N runs' or 'much slower than its last N runs', as hygiene work. A zero-dependency node reporter records each test; flaky is a fact (mixed outcomes on one clean tree), slower needs 2x the median and a floor. Design: research/2026-10-06-spec-rigor.md."
evidence: []
issue: 11
---

# Every test run is remembered, and a flaky or slower test becomes hygiene work

## Done when

After `npm test` in keel and in one adopted project, the run ends with a hygiene block naming any test that was flaky or got slower over its last N runs, with the command to reproduce it; the night's health page counts both; and one real hygiene item has been found and fixed this way.

## Scope

The design is [How rigorous is a keel spec](../research/2026-10-06-spec-rigor.md), lever 2.

- **The ledger.** `scripts/keel/test-ledger.mjs`, a node test reporter
  (a shipped practice file), run beside the usual reporter. Per test:
  file, name, outcome, milliseconds; per run: commit, tree hash, dirty or
  clean, machine class, date. Appended to `.keel/test-runs/` (ignored in
  git); CI uploads it as an artifact.
- **Flaky** is a fact: a test that both passed and failed on the same clean
  tree. No threshold.
- **Slower**: duration above both twice its median over its last N passing
  runs on the same machine class, and a floor (default +200 ms). N and the
  floor are config, with defaults.
- **The hygiene block** at the end of the run: each flaky or slower test,
  its history in one line, and the command to run it alone. A clean run
  prints one line, or nothing.
- **The night**: `flaky_tests` and `slow_tests` measures (bound 0), from the
  CI artifacts of the last N runs on the default branch; the proposal names
  the worst one. `keel loose-ends` lists them.
- **The AGENTS block**: a hygiene note is work. Fix it or file it; never
  rerun until green.
- Vitest projects (isocan) are out of this phase: node's runner first; a
  JUnit reader can follow.

## Acceptance

- [ ] The reporter records every top-level test with outcome and duration and changes nothing about the run's exit code or normal output. `tests/test-ledger.test.mjs`
- [ ] Flaky: a synthetic history with one test passing and failing on the same clean tree is named flaky; the same mix across different trees, or on a dirty tree, is not. `tests/test-ledger.test.mjs`
- [ ] Slower: a test at 2.5x its median and +300 ms is named; one at 2.5x but +50 ms (under the floor) is not; mutation: dropping the floor fails the test. `tests/test-ledger.test.mjs`
- [ ] The night's measures read the CI artifacts and are n/a, never zero, when there are fewer than N runs. `tests/improve.test.mjs`
- [ ] ⚑ by hand: the conductor runs keel's suite ten times, reads the hygiene block, and fixes or files what it names.

## Real surfaces

- Workflow shell: the CI upload step in `check.yml` and the night's artifact read.
- Adopted project: one adopted project's `npm test` gains the reporter through `keel update`.

## Proof

- Automated: `node --test tests/test-ledger.test.mjs tests/improve.test.mjs`, with the mutation above; `npm run check`.
- By hand: ten runs of keel's suite, the hygiene block read, and the item it names fixed; the CI artifact downloaded and read by the night on keel.
- ⚑ The update PR in the adopted project (the owner merges).

## Deliberately open

- **Vitest and other runners** (isocan): through JUnit output, once the node
  ledger has run for a week.
- **Whether the night files a hygiene issue by itself.** Not at first: it
  proposes on the health page, a person files.

## Next action

Write `scripts/keel/test-ledger.mjs` from today's probe (a reporter that yields one JSON line per top-level test) and its test with a synthetic history.
