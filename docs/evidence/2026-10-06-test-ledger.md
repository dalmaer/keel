# Evidence: phase 33, every test run is remembered

Against the working tree on `9a97f08` (the phase's commit is titled "phase 33: every test run is remembered, and a flaky or slower test becomes hygiene work"). Built by a subagent; verified by the conductor.

| Did | Observed |
| --- | --- |
| `node --import ./tests/helpers/hermetic.mjs --test tests/test-ledger.test.mjs tests/improve-ledger.test.mjs tests/migrations-test-ledger.test.mjs tests/improve.test.mjs tests/improve-selftest.test.mjs tests/workflows.test.mjs` | exit 0, 45 tests, 45 pass |
| Read `tests/test-ledger.test.mjs` | The reporter test runs a real `node --test` on an Acme file whose test fails under `ACME_FAIL`, and asserts the recorded runs and the hygiene line; flaky and slower are tested against synthetic histories with built-in mutants (flaky ignoring the tree or the dirty flag; slower without its floor), each asserted to fail |
| Builder's mutations, restored | flaky ignoring tree or dirty flag; dropping the floor (in-test and once by hand on the source); a measure returning 0 instead of n/a; 0004 touching `vitest run`; workflow steps without `always()`, without hidden files, reading other branches' artifacts, writing inside the read, or gathering after Measure: each fails a test |
| `actions/upload-artifact` tag | the builder wrote `@v6` from memory; `v6` exists, `v7.0.1` is current and keel's other actions are on v7; v7's `action.yml` has `name`, `path`, `include-hidden-files`, `if-no-files-found`, `retention-days`. Switched to `@v7`, re-rendered |
| Builder: ten runs of keel's `npm test` on its working tree | all exit 0, 25–27s, 375 top-level tests each; hygiene line "no flaky or slower test (10 runs)". On a dirty tree flaky is never judged, and slower needs 20 earlier runs, so this proves the reporter runs, not the analysis on real data |

**The gate:** `npm run check` on the final tree with this record; its result is in the commit body.

**Not done yet (needs the commit):** ten runs on the committed clean tree read by the conductor; the pushed commit's `check.yml` artifact and the next night reading it; one adopted project's update PR with migration 0004 (⚑ the owner merges).

**Docs updated in the same change:** the night and ci practice READMEs, the night AGENTS block (a hygiene note is work), `lib/agent-guide.md` topics, `README.md`.

## Walked after the commit (b910f1f)

| Did | Observed |
| --- | --- |
| Ten runs of `npm test` in a clean worktree of `b910f1f` (outside the working checkout) | all exit 0; each ended "keel test ledger: no flaky or slower test (n runs)"; the ten records: dirty false, one tree hash, 375 tests each, 0 failures. Flaky was judged (clean tree) and found nothing; slower stays unjudged below 20 runs |
| CI `check` run 37505442975 on `b910f1f` | success; artifact `keel-test-runs` (15,456 B): one run, commit b910f1f, dirty false, linux x64 4 CPUs, 375 tests, 0 failed |
| Dispatched keel-night, run 37505860555 | exit 0; "test ledger: 1 artifacts read; 1 runs"; Measure: `flaky_tests` and `slow_tests` n/a, "recorded runs: 2, fewer than the window of 20" |

The once-in-five failure of 6 Oct did not recur in these ten runs.

## Walked at the fleet release (v0.8.0, 6 Oct)

| Did | Observed |
| --- | --- |
| Migration 0004 in the v0.8.0 update PRs | duo#63, cajones#36, ledger#55 rewrote their `node --test` scripts to add the reporter; each PR's own checks green; merged at the owner's instruction |
