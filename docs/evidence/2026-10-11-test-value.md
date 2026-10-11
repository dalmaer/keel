# Phase 69: test cost, coverage and usefulness (2026-10-11)

11 October 2026, Node v24.21.0, macOS arm64, 14 logical CPUs. Baseline
`3ef01bef9dd4f4f06b8dfce425712ac118fca4dd`; observations below describe the
working tree and archived benchmark snapshots, not a clean pushed revision.

The conductor used two builders for independent historical/coverage analysis
and bounded workflow/package changes, verified the changed tests independently,
and retained the source and result of negative controls.

## Evidence

- [Audit and interpretation](../research/2026-10-11-test-value.md).
- [Fifteen historical failure cases](../research/2026-10-11-test-history.md).
- [Retained receipt counts and failing identities](../research/2026-10-11-test-observations.md).
- [Matched benchmark results](2026-10-11-test-audit/bench-results.json).
- [Native coverage summary](2026-10-11-test-audit/coverage-summary.json) and
  [source hashes and unobserved function entries](2026-10-11-test-audit/coverage-files.json).

The retained scripts under `2026-10-11-test-audit/` are the measurement programs
used on this machine, not new shipped CLI commands. They retain the absolute
repository/scratch paths and baseline revision to identify the observation.
Run them from the repository root on this machine; on another machine adjust
those location constants explicitly. Raw profiles and detailed transient logs
remain in `/tmp/keel-test-audit/`, not in Git.

## Independently verified proof

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/improve-selftest.test.mjs tests/workflows.test.mjs tests/package.test.mjs tests/helpers.test.mjs tests/evidence.test.mjs
```

66 tests passed, zero failures, 9.506 seconds. This includes the final optional
rendered-workflow checks and cancellation addition. Log:
`/tmp/keel-test-audit/final-focused.log`.

```sh
node /tmp/keel-test-audit/selftest-sensitivity.mjs
node /tmp/keel-test-audit/cancellation-sensitivity.mjs
node /tmp/keel-test-audit/phase69-launch-counts.mjs
node /tmp/keel-test-audit/bench.mjs
```

Three broken selftest implementations (first miss only, unavailable ignored,
broken ignored) each failed at its intended assertion. Two broken cancellation
implementations (no signal registration, leaked listeners) each did likewise.
The scripts modify disposable copies only. Packing controls omit an optional
practice or a template from the observed inventory and require exact missing
paths. Workflow mutation guards check changed bytes and named diagnostics.

The matched four-file benchmark ran before/after/after/before, with no competing
test suite: 42.189/44.925 seconds before and 10.459/12.112 seconds after, all
passing. Later workflow coverage additions were not in those snapshots; the
final five-file proof above confirms the expanded set remains quick. No claim
of a whole-suite 74% gain is made. Full-suite timings need their own comparison.

The three subsequently extended release/transport cases also passed an
independent focused native-coverage run (1.736 seconds). The separate boundary
supplement confirms entries into `candidatePractice`, `space` and `groups`.
They reuse existing fixtures and test registrations; the final gate includes
both changed files.

## Collection failures kept visible

The manual V8 shutdown preload was rejected because it emitted stderr errors.
The native full collection later ran all 1,517 then-current test events, with
three failures: phase-record lint in CLI/doctor, and Node's injected coverage
environment variable in a strict Loop allowlist test. The record was fixed;
the allowlist assertion was preserved. A focused uninstrumented follow-up of
those three cases passed (5.088 seconds). Cancellation coverage was collected
separately after adding that test. Instrumented observations do not enter the
ordinary speed comparison or product-failure tally.

One package probe failed on an inherited npm cache write; its fixture now uses
a temporary cache. A newly tightened install mutation initially expected the
wrong diagnostic; the source still had other config readers. The corrected
assertion names the missing setup read. Both original failure logs are retained;
neither was hidden by retrying unchanged code until green.

## Final gates

`npm run check` covers the full integrated suite, configured stalls, roadmap,
rendered managed files and inbox. `npm run typecheck` covers the explicitly
selected production contracts. Their result belongs to the commit record;
this file is written before the final gate. CI on the pushed revision remains
separate evidence, not a substitute for these local checks.

## Limits and remaining value questions

A reported test count is not a count of independent behaviors. Consolidation
removes redundant instrument/process work; two cheap added registrations cover
previously missing isolation and cancellation behavior. No target count was
achieved by hiding cases. Historical silence is not a deletion criterion.

No new runtime dependencies, production behavior or managed practices changed.
The audit does not certify every branch, live service, browser or operating
system signal path. Query syntax guards are not jq execution, and guide-family
parsing remains an identified documentation-lint limitation. Those constraints
are explained in the research, rather than presented as 100% coverage.
