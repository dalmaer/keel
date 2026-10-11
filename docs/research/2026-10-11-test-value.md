# Test value and cost audit (2026-10-11)

11 October 2026; baseline source `3ef01bef9dd4f4f06b8dfce425712ac118fca4dd`.
Recorded under [phase 69](../phases/69-tests-earn-their-cost.md).

## Questions and evidence

The owner's question is whether 1,516 reported tests are fast, useful, redundant,
or missing important coverage. Test registrations are not equivalent to logical
cases, instrument executions, subprocess launches or independent contracts.
This audit combines retained execution records, native V8 coverage, source
inspection, historical fixes and negative controls. None alone establishes test
quality. It makes no claim that the suite is globally optimal.

[Historical review](2026-10-11-test-history.md) traces 15 representative cases.
An existing integrated CLI check caught a real ordinary-proposal regression
that 187 focused checks missed (`6bbf0f6`). Packed installation, workflow syntax,
and child-runner execution checks were added after escapes (`b269dad`,
`78a7e5c`, `d7d4967`). Git settings, random prefix collisions and deadline races
caused test defects (`61836a5`, `bbd0dcb`, `908904d`). A changed test is not evidence
that it caught the original bug. Missing old logs remain missing; no defect
rate or per-test return-on-investment ranking follows from this selected history.

## What 1,516 means

The retained successful receipt reports 1,426 top-level test events plus 90
nested events, across 102 files. Twenty parent tests contain children; there
are 1,496 leaf events. These are execution counts, not independent contracts.
The ledger intentionally stores top-level outcomes separately from its complete
hierarchical inventory. Two nested cases share a name and another identity was
redacted, so the receipt explicitly marks exact identity mapping incomplete.

[Retained observation audit](2026-10-11-test-observations.md) lists the failing
identities and evidence limitations. Its 168 saved records include 52 gate and
53 stalls receipts with intentionally empty test arrays; these are not empty
test executions. The 63 actual test summaries contain 55,890 repeated top-level
observations. Available raw records retain 61 failed observations; all inspected
test records were dirty development trees, so this is not a clean-revision
flake rate or a production defect count.

## Consolidation chosen

- The selftest mutation matrix previously ran every real measure for every
  mutation of every measure. Keep the full real-instrument baseline in
  `tests/improve.test.mjs`, but surround each mutant with home/project outside
  sentinels. Preserve every identity and all three failure modes, ordering and
  mixed aggregation. Add an all-misses check. Null-bound neutral readings now
  use numeric zero and must specifically produce `ok`, instead of accidentally
  testing another broken instrument.
- Keep the clean syntax scan of every workflow template and rendered workflow.
  Syntax mutations need only the affected block extracted from the real night
  template. Remove a redundant clean typecheck invocation. This eliminates 57
  syntax subprocess launches for the current templates.
- Move the default health-page/files assertions into the existing PR-create
  fixture and remove the identical extra fixture. This removes nine direct
  launches plus its uncounted descendants, while retaining ignored/custom
  paths, deletion, stray-file, symlink and PR-error cases.

No production behavior or shipped practice is changed by these optimizations.
The raw registration count is not reduced by renaming or hiding matrix cases.

## Missing coverage addressed

- The package test used packed manifests to decide what ought to be packed.
  Derive expectations from the checkout, so omitting an entire optional
  practice cannot remove both the observation and its oracle. In-memory
  omission controls require exact missing manifests/templates; use the same
  real pack and keep packed init and its nonempty generated gate.
- Extend helper isolation checks to canvas transport, fresh GitHub reads,
  review receipts and transcripts, with every unrelated isolation field
  satisfied. A nonexistent executable ensures a missed guard cannot contact
  a real service. Check runner-variable removal without mutating the input.
- Check all selftest misses, not merely one, and distinguish `ok`, `n/a` and
  `broken` in the mutation matrix.
- Add candidate rehearsal-version and default canvas space/group-list adapter
  assertions to existing release/transport cases. Focused native coverage
  confirms all three previously unobserved functions execute; no extra test
  registration or full publication fixture is needed.

## Measurements and sensitivity

Command, before source edits:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/improve-selftest.test.mjs tests/workflows.test.mjs tests/package.test.mjs
```

36 passed; process total 48.732 seconds, selftest 48.656 seconds. A preliminary
selftest-only observation after narrowing took 5.345 seconds (test body 5.286).
These different competing workloads are not a matched suite speedup.

A subsequent matched four-file benchmark added `tests/helpers.test.mjs` and ran
archived baseline/current-test snapshots in before/after/after/before order:
42.189 and 44.925 seconds before; 10.459 and 12.112 seconds after. All four
observations passed (39 baseline registrations, 40 after the helper coverage
addition). The average targeted time fell 74.1%; this is not the whole-suite
speedup. Later pure workflow policy additions are not included in those snapshots.
The retained benchmark script and numeric results are in
[the audit artifacts](../evidence/2026-10-11-test-audit/bench-results.json).

The selftest matrix has 39 measures: 4,563 evaluations before versus 390 after,
including the new all-misses case. The 117 individual mutant identities remain;
real instrumentation is still checked by the separate full baseline. All times are this machine's
observations, not promises for CI or adopters.

Three disposable copies of `lib/improve.mjs` were mutated independently:
truncate missed results to the first; ignore unavailable results; ignore broken
results. Each optimized test run exited 1 at its intended assertion. The source
checkout remained unchanged. Script and logs: `/tmp/keel-test-audit/selftest-sensitivity.mjs`
and `mutation-*.log`. Workflow mutations retain named syntax diagnostics and
assert that each mutation changed bytes.

## Coverage collection caveat

The first diagnostic preload manually called V8's take/stop coverage in an exit
hook. It interfered with Node's coverage shutdown and emitted `Precise coverage
has not been started` to stderr, causing assertion failures. That run is not a
passing baseline and those failures are not product regressions. Native
`NODE_V8_COVERAGE` without the manual hook passed the pilot; collection across
all test files and their children is recorded below. Instrumented timings are
excluded from ordinary performance comparisons.

The native full-file collection completed with 1,517 events: 1,514 passed and
three failed. Two were new phase-record formatting omissions caught by existing
CLI/doctor checks and corrected; the third was Node injecting `NODE_V8_COVERAGE`
into a child's otherwise explicitly allowed environment. All three passed in a
focused uninstrumented follow-up. The allowlist assertion was not weakened.
This is diagnostic coverage with known stopped scenarios, not an all-green run.

An unobserved `runMeasurement` signal handler led to a new cancellation check:
SIGINT, SIGTERM and SIGHUP terminate the synthetic process group and restore
signal/exit listeners. It passed ordinarily and under native coverage (about
0.12 seconds overall). Isolated mutations removing signal registration and
listener cleanup failed at the named assertions. This covers the host-listener
path; it does not establish OS delivery and default re-raising in every host.

## Native coverage inventory

The full collection contains 8,493 parseable native profiles from 8,230 distinct
PIDs. Exact checkout source URLs observed 102 of 113 tracked production `.mjs`
modules; four shipped test templates are separately excluded. File-qualified
function entries were positive for 4,377 of 5,338 observed slots. Collapsing
30 byte-identical manifest-declared canonical/rendered pairs gives 4,218 of
4,646 observed slots. These are **function entry observations**, not line,
branch, assertion or whole-program coverage percentages.

Unobserved modules contribute no known function denominator. Copied project,
worktree, emitted-browser and evaluation URLs are excluded, so absence does not
mean those behaviors never ran. Abruptly killed children may not flush profiles.
The raw profiles remain local (about 1.46 GB); compact module/hash/zero-entry
records are retained in [coverage artifacts](../evidence/2026-10-11-test-audit/coverage-files.json).
The cancellation supplement is separate from these frozen counts.
[Source-by-source interpretation](2026-10-11-test-coverage.md) explains all eleven
absent paths and distinguishes copied execution from confirmed adapter gaps.

## Further candidates, not automatic deletions

The subsequent [guard scheduling experiment](2026-10-11-guard-scheduling.md)
tested a three-file split and lower concurrency. Its focused gain did not
establish a dependable whole-gate gain, so both changes were withdrawn.

Repeated full-tree generated-file probes and the real CLI verb sweep are costly,
but cover distinct delivery and dispatch boundaries. Consider fixture narrowing
only with measured savings and retained negative controls. Do not remove them
because they overlap unit tests or have no retained failure.

Rendered optional workflows now participate in all six relevant policy and
budget checks. Missing configured outputs fail; present optional outputs are
checked regardless of configuration. Existing climb/tend gather tests now
reject expiry filtering, oldest-first and multiple-ID selection mutations in
the real extracted query. Selected mutation cases require their intended
error, not merely any error. No new fixture or test registration was needed.

These artifact-query guards inspect structure; they do not evaluate jq or prove
pagination completeness. A real query evaluator would be needed for that
stronger claim. The unknown-subcommand guide-parser finding is a documentation
lint limitation, not an observed broken CLI dispatch, and remains a bounded
follow-up. Refused-render byte preservation already has behavioral coverage
in doctor/guide tests, so duplicating it was rejected. Signal default re-raising,
live external transport wrappers, copied-source attribution and browser-emitted
code require separate interpretation rather than counting all zero entries as
missing tests.
