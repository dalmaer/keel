---
status: partial
owes: walk
since: 2026-10-09
goal: G4
spec: 2
depends: [33]
note: "Built: scripts/keel/test-ledger.mjs --junit reads bun's and vitest's JUnit XML into the node ledger's record (plus runner and a hash of the file), with the same no-tests rule and hygiene block; the runner is in the config hash and the lane; adopt records the runner and proposes the gate line; doctor lints \"tests\". Owes the walk: a week of records on one bun project and one vitest project, read by the owner. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
evidence: []
issue: 46
---

# The test ledger reads bun and vitest

## Done when

A project whose tests run on `bun test` or vitest gets the same ledger records as one on `node --test` (each top-level test's file, name, outcome and time, with the run's commit, tree, machine and config), and `flaky_tests` and `slow_tests` work on it; one real project on each runner has a week of records.

## Scope

The design is [Adopting projects that already have a practice](../research/2026-10-09-adopting-projects-that-ship-to-main.md), change 2.

- **The runners**: `.keel/keel.json` `"tests": { "runner": "node" | "bun" | "vitest", "junit": "<path>" }`. Adopt detects it (a `bun test` or `vitest` in the gate) and records it.
- **The record**: `scripts/keel/test-ledger.mjs --junit <file>` turns JUnit XML (`bun test --reporter=junit --reporter-outfile`, vitest's `--reporter=junit --outputFile`) into the ledger's record, with the same `commit`, `tree`, `dirty`, `machine`, `config` and `setting` as a node run. "No tests ran" holds the same way.
- **The gate**: adopt proposes the reporter flags for the project's gate (it never rewrites the gate silently).
- **Unchanged for node**: the node reporter stays as it is.

## Acceptance

- [x] A JUnit file from each of `bun test` and vitest (fixtures) becomes a ledger record with every test's outcome and time, and the run's commit, tree and config. `tests/test-ledger.test.mjs`
- [x] A JUnit file with no tests is "no tests ran" (exit 1), as a node run is; `allowEmpty` lets it pass. `tests/test-ledger.test.mjs`
- [x] `flaky_tests` and `slow_tests` read bun and vitest records as they read node's. `tests/improve-ledger.test.mjs`
- [x] Adopt detects the runner and proposes the reporter flags for the gate. `tests/adopt.test.mjs`
- [ ] ⚑ by hand: one project on bun and one on vitest record a week of runs, and the owner reads their hygiene block.

## Your part

- **Ask:** After a week, read the test-hygiene line on one project that uses Bun and one that uses vitest, and say whether it named the right flaky or slow tests.
- **Why:** It is the first time keel's test memory works outside Node's own runner.
- **Look at:** Each project's newest health page, the flaky and slow tests line.
- **Choices:** Right | Missed some | Wrong
- **Takes:** 10 minutes.
- **Then:** Right: the phase is built. Missed some or wrong: the cases go into the evidence and the reader is fixed.
- **Ready when:** two projects, one per runner, have a week of records.

## Real surfaces

- Adopted project: one on `bun test`, one on vitest.
- Workflow shell: the night reading their records.

## Proof

Automated: `node --test tests/test-ledger.test.mjs tests/improve-ledger.test.mjs tests/adopt.test.mjs`; `npm run check`.
Over time: a week of records on each runner.

## Deliberately open

- **Parts inside a test**: JUnit nests suites and cases differently per runner. Top-level tests first, as the node ledger does. Settled 2026-10-09 for now: a top-level `describe()` is one entry, failed when a test in it failed, as node records it; the tests inside are not kept.
- **A name with " > " in it** (a known limitation): bun joins describe names in `classname` with " > ", innermost first, and vitest joins them into the test's name, outermost first. The ledger splits on " > ", so a describe (vitest: also a test) whose own name holds " > " is cut there, and two top-level tests can be read as one. Settled when a real project shows one, by reading bun's nested `<testsuite>` form if it writes one.
- **A narrowed bun or vitest run** (a known limitation): the ledger reads the file after the run and cannot see `-t` or a path filter, so such a run is never marked `filtered`. `proofs_hold` could read a cited test the run left out as renamed. Settled when a project narrows the gate's run, by a `--filtered` flag the gate passes.
- **bun's escaping**: bun 1.2.13 escapes `classname` twice. The ledger reads it once more, and also reads a `classname` escaped once, should a later bun fix it.

## Trajectory

- **2026-10-09** — Real output changed three things. bun leaves a file that would not load out of its JUnit entirely (it says "1 error" and exits 1, and the file has no testcase for it), so a gate of `bun test …; node test-ledger.mjs --junit …` would pass it: the ledger takes the runner's exit code as `--status $?`. bun writes no JUnit file when no test ran, so a file from an earlier run would be read again: each record keeps a short hash of its file, and a file already recorded is stale, "no tests ran". bun makes no directory for `--reporter-outfile`, so the proposal starts with `mkdir -p .keel/test-runs`. doctor had never checked `"tests"`: it now does (`tests-config`).
- **2026-10-09** — Review on #56 reshaped the proposed line. `runner; ledger --status $?` never reaches the ledger under `set -e` (GitHub's `bash -e`), so a red run went unrecorded: the line now keeps the code as `|| keel_status=$?`. It removes the old JUnit file first, so a run that writes none is "no tests ran", and the stale check is per path (a hash of the path and the bytes), so two packages' identical reports are two runs. After a `cd`, the paths start from git's top level. No line is proposed where the night practice is not on and the ledger is not there. Quoted operators are words, and a JUnit path must need no shell quoting.

## Next action

⚑ Walk: put the proposed gate line on one project that uses bun test and one that uses vitest; after a week of records, read each project's flaky and slow tests line on its newest health page, and say Right, Missed some or Wrong.
