---
status: built
since: 2026-10-10
goal: G0
spec: 2
depends: [67]
note: "Fresh GitHub reads overlap with deterministic output; local overlap rejected after measurement."
evidence: ["evidence/2026-10-10-independent-reads.md"]
---

# Independent reads do not wait for each other

## Done when

Reconciliation reads GitHub PRs with bounded concurrency while preserving deterministic observations and failures, and local timing work is measured and optimized only where evidence supports it.

## Scope

At most four concurrent fresh PR observations, retaining per-request timeouts,
sorted output and independent unknown states. Measure local history, retention,
summary and transcript costs before deciding which work to overlap or reduce.
No stale merge cache, new dependency, output schema change or acceptance inference.

## Acceptance

- [x] Reconciliation overlaps independent reads, caps concurrency and preserves sorted results and partial failures: `tests/reconciliation-parallel.test.mjs`.
- [x] Local timing stage measurements justify retained changes, with unchanged coverage and output semantics: `tests/time.test.mjs` and the research record.
- [x] Real read-only GitHub and local before/after observations report context and limitations without calling child waits pure network time: `node /tmp/keel-phase68/github-bench.mjs` and `node /tmp/keel-phase68/time-cost/keel-time-bench.mjs`.
- [x] Integrated checks and selected type contracts pass: `npm run check` and `npm run typecheck`.

## Real surfaces

- Owner's machine: before/after local timing measurements.
- GitHub API: fresh read-only reconciliation measurements against the same records.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/reconciliation.test.mjs tests/reconciliation-parallel.test.mjs tests/reconciliation-integration.test.mjs tests/time.test.mjs`
`npm run typecheck`
`npm run check`

Research records name exact measurement commands, samples and limitations.

## Deliberately open

Further caching and runtime migration are deferred. Local residual wall time is
not CPU time, and GitHub latency varies; measurements do not guarantee a speedup
for every project or invocation.

## Next action

None. Repeated fleet use is needed before claiming lived-in adoption.

## Trajectory

- **2026-10-10** — Transcript processing dominated local timing, but overlapping independent readers saved only about 2 ms within variation. No local runtime change was retained; fresh GitHub read overlap showed a clear measured benefit.
