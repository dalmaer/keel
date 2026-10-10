# Evidence: phase 57 — timing proposals and verified remeasurement

- Date: 2026-10-10
- Phase: [57](../phases/57-time-getting-worse-becomes-a-proposal-and-a-fix.md)
- Revision: `30041ba` plus the working tree for `phase 57: Time getting worse becomes a proposal, and a fix`; base main `e93af4fd193e23a00a1ad4188e1e7446631fba60`.
- Claim: comparable bounded observations can propose a concrete fix; explicit acceptance recovers one robot issue; an installed night compares fresh ancestry-verified observations with immutable original evidence. This is implementation proof, not two completed real fixes.

## Automated checks

The conductor independently ran, from the repository root:

```sh
node scripts/render.mjs --self --check
node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout tests/time-measures.test.mjs tests/time-proposals.test.mjs tests/time-proposal-actions.test.mjs tests/time-improve.test.mjs tests/test-history.test.mjs tests/improve-measures.test.mjs tests/improve.test.mjs tests/board.test.mjs tests/test-ledger.test.mjs tests/stalls.test.mjs tests/time.test.mjs tests/robot-budget.test.mjs tests/robot-delivery.test.mjs tests/robot-runtime.test.mjs tests/workflows.test.mjs
```

Both exited 0. Render checked 72 targets. The test runner reported 351 tests, 351 passed, no failures, and no flaky/slower hygiene findings. Local diagnostic: `/tmp/phase57-conductor-proof.log`.

These checks exercise actual Node processes, independently resolved expected files, per-file and aggregate summaries, explicit quiet/context eligibility, bounded retention, configured outer gates, typed/redacted stalls receipts, recorded-seed replay, numerical minima, newest-three gate comparison, and exhaustive successor inventories. They reject missing ancestry, ambiguous identities, omitted targets, unsupported topology, skipped comparisons and mismatched provenance.

The acceptance tests interrupt issue creation after durable intent, recover without a duplicate POST, preserve an enabled-but-unqueued verified issue, and require the current instance. Thirty health refreshes retain one current report, the frozen proposal and human notes; non-time accept/decline decisions also survive. Managed report drift refuses a write.

A night-only adoption runs installed `improve --report --json` with real local Git and ledger files and synthetic read-only GitHub transport, without injecting the evaluator or remeasurement. Its reviewed successor mapping yields inside at 0.3, then removing a successor identity yields unavailable. Both installed invocations exit 0; the baseline, mapping and owner notes remain unchanged. Ownership-transfer tests retain installed delivery/budget bytes and refuse owner drift. The CI workflow shell records one actual configured gate with night installed and preserves the check exit in CI-only adoption.

`node scripts/keel/reconcile.mjs --json` exited 0 with no findings. Legacy records without structured references remain advisory; this does not infer their acceptance from GitHub.

The first full integration exposed an outdated one-line CI assertion and isolated fixtures that omitted the ledger's new sibling module. These failures are preserved in `/tmp/phase57-final-gate.log`; fixture dependencies and the custom-check assertion are corrected before the final gate.

The final integrated command is `npm run check`: all tests plus roadmap, managed render and inbox guards. Its result belongs in the phase commit body, after this record.

## Real surfaces

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Called production `recoverTestHistory` against `dalmaer/keel`, main, with lower bounds of 20 discovered artifacts, 16 MiB and 200 records, into a temporary directory | Exit 0; admitted night run 38034985959 and CI runs 38043221314 and 38035941679; 77 records, 8,601,360 uncompressed bytes. `readRuns` read all 77 with zero skipped (73 ordinary, four gates). | Real GitHub API identities, archive format/digest and bounded data-only recovery. No remote writes or artifact code execution. |
| Read recovery coverage | Incomplete: discovery cap, 17 rejected identities, seven missing weekly bins, and a legacy cumulative artifact without coverage diagnostics. No archive/digest rejection or record conflict. | Missing history remains visible. The combined identity error does not identify each individual rejection reason. |
| Ran the production six time measures over that recovered legacy history in CI mode | All six n/a with null values. | Older observations are not silently relabelled into new provenance or healthy zero values. No live new suite/stalls evidence was present. |
| Ran installed-night and actual workflow-shell tests described above | Passed with synthetic external transport and real installed scripts/processes. | Packaging and execution integration, not a deployed nightly owner walk. |

Read-only probe diagnostics: `/tmp/phase57-history-live-result.json`, `/tmp/phase57-live-measures.json`. The bounded sample is not a claim of complete execution history.

## Hygiene observation

A builder observed the unchanged stalls interruption test fail its SIGTERM scheduling assertion during development. The cause is not established. It is recorded separately in [hygiene issue 69](https://github.com/dalmaer/keel/issues/69#issuecomment-6096562986), including the isolated diagnostic command; later green integration does not erase that observation.

## Gaps and decision

Phase 57 is **partial, owes walk**. No proposal was accepted against a live GitHub issue, no robot was enabled, and no new model allowance was scheduled. The owner must first choose the phase 54 project and weekly model-step allowance, then accept two actual timing proposals, inspect their independently reviewed PRs and merge satisfactory fixes. Subsequent nights need the stated comparable postmerge samples/dates and any reviewed topology mapping before reporting inside or outside. Missing evidence stays unavailable.

Issue acceptance, implementation, GitHub merge, production verification and lived-in usefulness remain distinct. A dominance change reports suite-wall measurements descriptively and never alone claims faster execution. Bounds remain investigation defaults to evaluate during use.

## Committed CI producer walk

[CI run 38045495955](https://github.com/dalmaer/keel/actions/runs/38045495955) succeeded on committed head `54a9c1ca7ab0d8810083dd65c868b94c01c3ea1b`. The conductor downloaded its 116,052-byte `keel-test-runs` artifact (11666923087) and inspected it as data, executing no artifact content. The ledger read skipped zero records. It contains exactly one completed configured-check outer gate, status 0, with linked inner payload and outer command hashes; measured wall time was 228,398 ms. The Node receipt reports 81 expected and 81 observed file summaries, complete file coverage, and 1,169 logical entries. All 33 typed stalls receipts were complete, with no read gaps.

Logical inventory completeness is false: redacted logical identity and ambiguous duplicate names were reported. This real sample can supply complete file timing but cannot by itself support an exhaustive topology transition. No identity was invented to clear that limitation. Local diagnostic: `/tmp/phase57-ci-producer-proof.json`.

## Review corrections: historical verdicts and local health aliases

Independent PR review found that the night updated an accepted proposal's older page but staged only today's page. `improve` now returns exact `changedHistoricalHealthPaths` only after successful changed lifecycle writes; the workflow validates those dated paths and commits them with today's page and the existing data allowlist. Actual cross-date improve output drives the workflow regression. Unrelated modified, untracked and pre-staged content stays out of the commit. Invalid metadata, ignored paths and escapes are refused before staging.

A compatibility audit also reproduced a local report failure through a configured health-directory alias inside the repository. The helper now resolves that configured directory and its lock canonically, preserves existing inside-alias behavior, and rejects outside aliases, page symlinks and unrelated paths. Nightly Git staging of a path beyond a symlink already failed in the baseline workflow; that limitation remains explicit rather than introducing a new Git-path or drain policy.

All three regressions have tool-generated VERIFIED red-before/green-after proofs against `54a9c1c`: the producer's cross-date changed-path metadata (`tests/time-improve.test.mjs`), actual historical-page staging (`tests/test-history.test.mjs`), and installed local report alias behavior (`tests/time-proposal-actions.test.mjs`). No trailer was invented.

The conductor ran the hermetic spec/ledger reporter command over `tests/time-improve.test.mjs tests/time-proposals.test.mjs tests/time-proposal-actions.test.mjs tests/test-history.test.mjs tests/workflows.test.mjs tests/board.test.mjs`: 141 passed and five board server checks were blocked by sandbox `listen EPERM` (exit 1). The exact five loopback checks were rerun with socket access, using `--test-name-pattern='the server binds 127|the page carries a strict CSP|the page refreshes from /board.json|the board runs a choice through|the board keeps its GitHub reads 10' tests/board.test.mjs`: five passed, exit 0. These are permission-boundary diagnostics, not flake reruns. Logs: `/tmp/phase57-review-fix-conductor-proof.log` and `/tmp/phase57-review-fix-loopback-proof.log`; no hygiene findings. The final integrated command remains `npm run check`, with its outcome recorded in the correction commit.

## Review correction: comparable postmerge observations

The second independent review reproduced a false inside verdict from dirty postmerge records whose commit names still passed ancestry. Comparison now requires explicit clean state, and gate/Node producers compare start/end commit, tree and dirty state before calling a receipt clean. The pinned-stalls path also preserves an unknown starting state instead of converting it to clean when Git status later recovers. These are endpoint checks, not continuous monitoring between snapshots.

Related actual evaluator audits reproduced two more gaps: critical-file date coverage used older observations outside the newest-three verdict sample; and a topology transition could waive machine comparability or be attached to a non-critical measure. The newest three now supply the verdict, dates, value and coverage together. Only critical-file mappings are supported; kind, project scope, runner and machine class must remain unchanged. Explicitly reviewed command/config/flags and test topology changes remain supported.

An actual Node producer probe showed a one-file subset inheriting the declared two-file command hash. Matched file/settings selection now establishes command comparability independently of success; successful complete runs supply timing, and complete failed runs can still supply inconclusive classification. Unknown or subset selection cannot borrow the full command identity. The reproduction uses actual receipt fields, with synthetic timestamps and baseline only to exercise the evaluator's window.

The conductor independently ran the hermetic spec/ledger reporter command over `tests/time-measures.test.mjs tests/time-proposal-actions.test.mjs tests/time-improve.test.mjs tests/test-ledger.test.mjs`: **125 passed, exit 0**, no hygiene findings (`/tmp/phase57-clean-comparison-conductor-proof.log`). Tool-generated VERIFIED regressions against `3e7b8ec` cover clean revision endpoints, pinned unknown state, critical sample dates, transition comparability at both action and evaluator boundaries, and actual subset selection. The final integrated gate remains `npm run check`; its outcome belongs in the correction commit.

The integrated clean-comparison tree passed 1,202 tests before the guide alignment. On the subsequent documented-tree gate, the new pinned-identity regression failed an unrelated exit-code assertion: its short child completed without an injected pause, so pinned enforcement correctly exited 1. The emitted receipt still correctly had `clean:false` for the unknown start. That observation is preserved in `/tmp/phase57-final-gate-5.log`; the regression now validates this legitimate no-pause outcome explicitly while continuing to assert the identity result, rather than retrying until a pause happens. The conductor reran that named test after the correction: one passed, exit 0, no hygiene findings (`/tmp/phase57-pinned-final-conductor-proof.log`). The regenerated pinned-state proof still fails on the original false-clean behavior and passes with the fix. The final gate result remains a commit-body fact.
