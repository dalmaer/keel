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
