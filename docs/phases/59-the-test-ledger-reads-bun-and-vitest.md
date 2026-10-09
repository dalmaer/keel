---
status: planned
since: 2026-10-09
goal: G4
spec: 2
depends: [33]
note: "The test ledger is a node --test reporter, so on a project that runs bun test or vitest it records nothing, and flaky_tests, slow_tests and phases 55 to 57 are n/a there. Both can write JUnit XML; keel reads it into the same per-test record. Design: research/2026-10-09-adopting-projects-that-ship-to-main.md."
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

- [ ] A JUnit file from each of `bun test` and vitest (fixtures) becomes a ledger record with every test's outcome and time, and the run's commit, tree and config. `tests/test-ledger.test.mjs`
- [ ] A JUnit file with no tests is "no tests ran" (exit 1), as a node run is; `allowEmpty` lets it pass. `tests/test-ledger.test.mjs`
- [ ] `flaky_tests` and `slow_tests` read bun and vitest records as they read node's. `tests/improve-ledger.test.mjs`
- [ ] Adopt detects the runner and proposes the reporter flags for the gate. `tests/adopt.test.mjs`
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

- **Parts inside a test**: JUnit nests suites and cases differently per runner. Top-level tests first, as the node ledger does.

## Next action

Collect a JUnit file from bun and from vitest as fixtures; brief a builder on `--junit`.
