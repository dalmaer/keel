# Roadmap follow-through — 23 October 2026

## Scope and authority

Record reconciliation and a narrow nightly-reporting correction. Phase acceptance
remains unchanged. GitHub owns merge
facts; reporting configuration proves local setup, never deployed behavior.

## Observed sources

- `gh pr view 130 --repo dalmaer/ledger --json mergedAt,mergeCommit,url`
  returned merged 2026-10-21T21:26:49Z at
  `30f454899bbaeb2615cd3a81f892ca0b1b7f206f`.
  [Source](https://github.com/dalmaer/ledger/pull/130).
- Read the private reporting workspace's `.plates/plates.json`: live mode and
  `liveKeys: ["loop-across-projects"]`. Read `publish-report.mjs`: fixed key.
  These observations do not prove a remote create/edit.
- Read immutable `editions/2026-10-19/publication-blocker.json`: stopped before
  writing because the adapter rejects a named grant expressly approved by the
  owner. No new remote access check or publication was performed in this task.
- [PR #229](https://github.com/dalmaer/plates/pull/229) at
  `48b9dfbc3dcde32f8b2aeb842448907d1c28684a` already reconciles phases 112/113/114.
  `plates review dalmaer/plates#229 --gate --json` returned gate true. Its
  source-only collector still reports no reuse authority. Phase 114 has another
  session's claim; these files are deliberately left to that existing work.
- Phase 109 also has an existing claim. Its stale rollout record needs the
  holder's reconciliation; this change does not overwrite that active work.

## Remaining proof

Phase 38 needs the post-merge night comparison and owner assessment. Phase 50
needs reviewed approved-grant support and real create/edit/conflict evidence,
then its separate GitHub/restart/scheduled-use proof. Neither phase is promoted.

## Nightly investigation

Read retained run logs and agent/judge artifacts, without rerunning agents:

- [22 October climb](https://github.com/dalmaer/plates/actions/runs/39763383976):
  five permission denials, 18 agent turns, and candidate commit `1411a45e`.
  The candidate changed test-fixture copying but had no recorded measured
  attempt. The judge discarded it; correctness and improvement are unproven.
- [23 October climb](https://github.com/dalmaer/plates/actions/runs/39939173199):
  six permission denials, 30 turns, and no candidate bundle. The retained result
  does not identify denied commands or explain why the agent stopped.
- Baselines each took roughly 25 minutes before the old `night.started` field;
  the historical one/two-minute summary was not total run cost. PR #233, already
  merged at this worktree base, adds sanitized denial receipts, timing separation
  and refusal of success-with-denials. No permissions or budgets were widened.
- Empty `night.tried` means no measured attempts recorded, not no exploratory
  work. A retained settlement that discarded an unmeasured candidate must remain
  incomplete, not become `no-candidate`. Later remediation does not rewrite the
  historical run or claim the discarded optimization worked.

## Checks

Initial focused preflight refused unsupported PATH Node v24.13.0 before tests.
The same unchanged documentation candidate passed the roadmap-focused convention
preflight with installed Node v26.12.1. This is runtime correction, not a flaky
rerun. The builder ran both failing-without-fix proofs below: each returned
VERIFIED, contrasting the old false no-candidate/health summary with retained
incomplete evidence. The conductor reviewed the regression's fresh-process,
retry, uncommitted, untouched and measured-losing-trial cases.

```sh
PATH=/opt/homebrew/bin:$PATH node bin/plates.mjs prove tests/climb-execution-regression.test.mjs --name 'settlement retains unmeasured work' --fix scripts/plates/climb.mjs scripts/plates/climb-execution.mjs practices/climb/files/scripts/plates/climb.mjs practices/climb/files/scripts/plates/climb-execution.mjs --base 5fc2f031 --trailer
PATH=/opt/homebrew/bin:$PATH node bin/plates.mjs prove tests/improve-climb.test.mjs --name 'the health page retains incomplete settlement evidence' --fix scripts/plates/lib.mjs practices/night/files/scripts/plates/lib.mjs --base 5fc2f031 --trailer
```

The conductor's final candidate commands, on base `5fc2f031` plus this change:

```sh
TZ=UTC PATH=/opt/homebrew/bin:$PATH npm run check:focused -- tests/climb-execution-regression.test.mjs tests/improve-climb.test.mjs tests/roadmap.test.mjs
PATH=/opt/homebrew/bin:$PATH npm run typecheck
TZ=UTC PATH=/opt/homebrew/bin:$PATH npm run check
```

The integrated gate covers the records and shipped copies as well as the runtime;
its result belongs in the commit/PR record. No fresh nightly agent was launched,
and production adoption remains unverified.

The final focused preflight initially detected three stale parser-source hashes
in the web capability audit. Reviewed the changed shipped modules: no grammar
or permission changed. Updated only those three hashes before the integrated gate.
