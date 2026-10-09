# Loop collection and validation — 8 October 2026

Ledger's October 6–8 Loop pulls succeeded; the project gate failed when the
Next.js type-checking worker exhausted its roughly 2 GB default heap. The
regular Tests workflow had a 4 GB allowance that the shared build command
lacked. Reference: https://github.com/dalmaer/ledger/actions/runs/37759948973.

Practice 0.8.22 keeps collection and validation separate in the run summary.
The verdict remains failing when validation fails. Read-only service calls
retry only recognized transient failures, twice at most; neither remote writes
nor validation is retried. `lib/loop-run-status.mjs` also handles historical
runs whose Gate shell returned success while their final Verdict failed.

Proof commands:

- `node --import ./tests/helpers/hermetic.mjs --test tests/loop.test.mjs tests/loop-run-status.test.mjs tests/workflows.test.mjs`
- `npm run check`

The initial full run hit localhost/npm-cache sandbox permissions. The run with
those permissions corrected exposed two existing expired quota-reset fixtures
and a workflow mutation test tied to the old Verdict label. The fixtures now
set a reset an hour ahead; the mutation still proves that setup credentials
cannot leak to the validation step. The focused 96-test run passed.

## Hygiene follow-up

The initial runs reported slow canvas tests while multiple suites were active.
This is a recorded performance investigation, not evidence of an intermittent
functional failure. Preserve the run records under `.keel/test-runs`; do not
rerun to erase the observations. Investigate in an otherwise idle checkout:

- `env -u NODE_OPTIONS node --import ./tests/helpers/hermetic.mjs --test tests/canvas-cli.test.mjs`
- `env -u NODE_OPTIONS node --import ./tests/helpers/hermetic.mjs --test tests/canvas-sync.test.mjs`
- `env -u NODE_OPTIONS node --import ./tests/helpers/hermetic.mjs --test tests/canvas-snapshot.test.mjs`

The most recent full run flagged the cross-binding rejection and disconnect
symlink tests, each around 0.33 seconds versus prior medians of 0.11–0.14 seconds.

Final Keel gate: 748 tests passed, zero failed; roadmap, managed-file render
and inbox checks passed. The final run additionally flagged the canvas flag
validation test (4.57s vs a 2.02s median); the idle-checkout investigation above
includes it. No test assertion was loosened and no validation retry was added.

## Hosted recovery and follow-up review

Ledger PR #109 merged as `91440d4e3eb9abeecfd136565d5884c435cbe848`.
Fresh run https://github.com/dalmaer/ledger/actions/runs/37883548697 passed
collection and validation. Deployment and Verify deploy also passed on that
revision; these checks do not establish lived-in acceptance.

A late review found that Google's symbolic `status` could hide its numeric
`code`. Practice 0.8.23 reads both representations and gives explicit auth and
permission rejections precedence. The mixed-envelope regression and integrated
`npm run check` passed: 749 tests, no flaky or slower-test warnings.

The shared canvas select styling was checked on Keel and Loop previews, including
narrow layouts, and the Keel edition was read back on isocan. Its preceding
748-test gate and GitHub CI passed without hygiene warnings.
