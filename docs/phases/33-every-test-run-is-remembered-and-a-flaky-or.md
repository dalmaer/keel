---
status: partial
since: 2026-10-06
goal: G4
spec: 2
depends: [10, 11]
note: "Built in keel: the ledger reporter on npm test, flaky and slower named in a hygiene block, flaky_tests and slow_tests on the night (from CI and night artifacts), proofs_hold's ledger half, migration 0004 for adopted projects. Waits on walks that need the commit: ten clean-tree runs, a real CI artifact read by the night, and one adopted project updated."
evidence: ["evidence/2026-10-06-test-ledger.md"]
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

- [x] The reporter records every top-level test with outcome and duration and changes nothing about the run's exit code or normal output. `tests/test-ledger.test.mjs`
- [x] Flaky: a synthetic history with one test passing and failing on the same clean tree is named flaky; the same mix across different trees, or on a dirty tree, is not. `tests/test-ledger.test.mjs`
- [x] Slower: a test at 2.5x its median and +300 ms is named; one at 2.5x but +50 ms (under the floor) is not; mutation: dropping the floor fails the test. `tests/test-ledger.test.mjs`
- [x] The night's measures read the CI artifacts and are n/a, never zero, when there are fewer than N runs. `tests/improve.test.mjs`
- [ ] ⚑ by hand: the conductor runs keel's suite ten times, reads the hygiene block, and fixes or files what it names.
- [ ] ⚑ by hand: one adopted project's update PR carries migration 0004 (its `npm test` gains the reporter), its own check is green on the PR, and the owner merges it.
- [ ] On keel's pushed commit, `check.yml` uploads `keel-test-runs`, and the next night's improve reads it (`flaky_tests`/`slow_tests` in its health page, n/a until enough runs). `node scripts/keel/improve.mjs --report`

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

On the committed (clean) tree: run keel's suite ten times and read the hygiene block; confirm the pushed commit's `check.yml` uploads `keel-test-runs`; then the adopted project's update with migration 0004 at the fleet release.

## Trajectory

- **2026-10-06** — The first case, before any of it is built: keel's suite failed once in five runs on an unchanged tree (main at `884dad1`, load average ~80), then passed twice more, and the failing test cannot be named because nothing recorded it. Baseline for "slower": the suite went 48s → 23s on the same day's hill-climb (median of three alternated runs each), so 23s is the starting median.
- **2026-10-06** — `night` now requires `agents-md`: the hygiene rule is an AGENTS block, and a block needs an AGENTS.md; migration 0004 adds its markers unless the block is skipped or ejected. Every fleet project with keel's night already has agents-md on.
- **2026-10-06** — `keel init` wires the reporter into a new project's `node --test` script, so a new project is never born behind on migration 0004.
- **2026-10-06** — Ten builder runs on a dirty tree, all green, named nothing, and proved little: flaky needs a clean tree, slower needs 20 earlier passing runs. The suite runs 25–27s with the reporter, against the 23s baseline.
