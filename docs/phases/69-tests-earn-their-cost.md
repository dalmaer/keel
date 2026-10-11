---
status: built
since: 2026-10-11
goal: G0
spec: 2
depends: [55, 57, 68]
note: "Removed redundant instrument/process work; retained failure history and coverage led to focused missing-boundary checks."
evidence: ["evidence/2026-10-11-test-value.md"]
---

# Tests earn their cost

## Done when

Measured redundant test work is removed without losing distinct behavioral contracts, missing checks found by coverage and history are addressed, and reproducible evidence explains test counts, cost and limits.

## Scope

Audit the whole suite's execution, subprocess coverage and retained failure
history. Optimize measured repeated work first. Preserve package delivery,
workflow execution, child-runner isolation and ownership boundaries. Fewer test
registrations alone are not a speedup; historical silence is not evidence that
a test is unnecessary. Keep runtime dependencies and the no-build workflow.

## Acceptance

- [x] An execution inventory explains reported test counts and retained ledger identities: `cat docs/research/2026-10-11-test-observations.md`.
- [x] Coverage includes subprocesses and identifies unobserved source and measurement limitations: `node docs/evidence/2026-10-11-test-audit/coverage-summary.mjs /tmp/keel-test-audit/native-coverage`.
- [x] Historical failures distinguish existing catches, post-escape tests, and test or environment defects, with source references: `git show 6bbf0f6` and `cat docs/research/2026-10-11-test-history.md`.
- [x] Removed work has an explicit surviving contract and sensitivity check: `node docs/evidence/2026-10-11-test-audit/selftest-sensitivity.mjs`.
- [x] Matched before/after measurements show the retained optimizations reduce work and time: `node docs/evidence/2026-10-11-test-audit/phase69-launch-counts.mjs` and the focused Proof command below.
- [x] Identified coverage gaps are fixed or explicitly assessed with remaining risk: `node --import ./tests/helpers/hermetic.mjs --test tests/package.test.mjs tests/helpers.test.mjs tests/evidence.test.mjs tests/release.test.mjs tests/canvas-sync.test.mjs`.
- [x] The integrated check and selected type contracts pass: `npm run check` and `npm run typecheck`.

## Real surfaces

- Published package: the focused Proof command and native coverage command above.
- Owner's machine: the observation audit and historical source commands above; unavailable GitHub records remain gaps.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/improve-selftest.test.mjs tests/workflows.test.mjs tests/package.test.mjs tests/helpers.test.mjs tests/evidence.test.mjs tests/release.test.mjs tests/canvas-sync.test.mjs`
`npm run check`
`npm run typecheck`

The evidence names exact coverage, benchmark and isolated mutation commands,
source revisions and observation limits. Instrumented timings do not stand in
for ordinary suite performance.

## Deliberately open

No blanket coverage percentage or minimum test-count reduction is an acceptance
criterion. A branch hit does not prove an assertion, and collapsing test names
must not erase distinct failure diagnostics.

## Next action

None for this audit. Revisit default board dispatch, OS signal re-raising and
real query evaluation when those boundaries change; sustained CI cost remains
a continuing measurement, not a claim of global optimality.

## Trajectory

- **2026-10-11** — The first diagnostic coverage preload interfered with Node's coverage shutdown and caused stderr failures. Its results are not a passing baseline; repeat with native coverage collection and no manual stop hook.

- **2026-10-11** — Test count was not the cost: 39 measures caused 4,563 evaluations in one registered test. Retaining every mutant with sentinels cut it to 390 evaluations; matched targeted timings fell from 42–45 seconds to 10–12 seconds.
- **2026-10-11** — Exact-source coverage misses copied and emitted execution. Source inspection explained all eleven absent module URLs; real gaps instead prompted cancellation, version-candidate and transport-adapter checks.
