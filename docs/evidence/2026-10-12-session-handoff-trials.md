# Evidence: phase 72 — bounded session handoff trials

- Date: 12 October 2026.
- Phase: [72](../phases/72-session-handoffs-improve-through-bounded.md).
- Revision: base `9efeff75f9af618f7b1a091c24a6dcd7713a8baf` plus the working tree for `phase 72: Session handoffs improve through bounded measured trials`.
- Claim: the explicit local CLI protocol validates, reserves, records, audits and changes only a scoped handoff policy. No observed saving is claimed.

## Automated checks

- Builder ran the session and helper tests: 34/34 passed. The conductor independently ran `node --import ./tests/helpers/hermetic.mjs --test tests/session-trials.test.mjs tests/cli.test.mjs`: 44/45 passed, exit 1. The sole failure was the existing CLI JSON test's `improve` child reporting EPERM when the sandbox prevented writing its timing ledger; all new session tests passed. Log: `/tmp/keel-phase72/focused.log`.
- After inspecting that permission failure, the conductor ran `node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='--json parses for every verb' tests/cli.test.mjs` with the required local write access: exit 0, 1/1 passed. Log: `/tmp/keel-phase72/cli-permissions.log`. This was an environment correction, not a flaky retry.
- `npm run typecheck`: exit 0. The existing explicit type scope is unchanged; this is not a claim that the new module is statically typed. Its external JSON is checked by runtime validators.
- `npm run render:check`: exit 0, 77 targets checked; 8 kept and 69 unchanged. No fleet practice changed.
- `node /tmp/keel-phase72/negative-controls.mjs`: exit 0. Two deliberate breaks were made in isolated module copies only. Removing the policy-adherence check falsely promoted unknown compliance; removing the budget gap check falsely promoted an over-budget trial. Both original checks reject those cases.
- Independent review reproduced and rechecked both corrections: an event beyond the cap is rejected before storage changes, redundant rollback is idempotent, and a different task class cannot enter later pairs or monitoring. It found no additional concrete issue in the final bounded inspection.
- First integrated gate: exit 1, 1588/1589 tests passed; the CLI usage string introduced a fictional `retro keel` subcommand to the guide surface checker. Corrected the usage convention and extended the exact negative-control expectation to include `retro sessions`. All eight stall checks passed, with no flaky/slower hygiene findings. The guide file was checked directly after correction.
- `npm run check` runs on the integrated tree after this record and the generated roadmap are written. Its result and the final `npm run typecheck` result belong in the commit body, rather than predicting them here.

## Packed CLI on this machine

`npm pack --ignore-scripts --json --cache /tmp/keel-phase72/npm-cache --pack-destination /tmp/keel-phase72`, then extract the tarball there and run `node /tmp/keel-phase72/packed-walk.mjs /tmp/keel-phase72`.

Exit 0: twenty separate public CLI invocations, without installed development dependencies, against an isolated Acme project. The initial default-cache pack was prevented by sandbox access to the user's npm cache; the successful pack used a task-local cache and did not change cache ownership.

| Checked | Observed | Scope |
| --- | --- | --- |
| Start preview | No session-trials directory created | Preview is read-only |
| Restarted process admission and finish | Six runs persisted, with baseline/candidate assignments | Durable local protocol |
| Handoff | Safe boundary receipt retained owner choice, proof and next action | Records a handoff; does not rotate a provider |
| Three complete synthetic pairs | Automatic transition baseline → candidate | Evaluator behavior, not real performance |
| Subsequent synthetic regression | Candidate → baseline, audit worse | Monitoring and rollback |
| `improve --sessions` | Reads the same experiment and verdict | Shared evidence, no second tracking authority |

Synthetic input/output receipts: `/tmp/keel-phase72/packed-walk-results.json`.
All example accepted outcomes, revisions, minutes and evidence pointers in this
walk are synthetic; they do not describe Keel delivery or external acceptance.

## Gaps and decision

Supports built, not lived-in. The evaluator consumes explicit attestations and
says it has not verified provider telemetry or the contents of evidence links.
Actual costs, the best threshold and causal savings remain unmeasured. The
runtime does not start or stop agents, transfer claims, enforce process timeouts
or create schedules. No real experiment was enabled or paid pilot launched by
this phase. Existing phase claims, spending approvals and acceptance records
retain their authority. Cooperative local writers must honor the storage lock;
this ledger is not a sandbox against hostile processes replacing directory
ancestors while a command runs.

## Local hygiene report: workflow syntax child stalled

On 12 October 2026 the corrected integrated gate stalled in the existing test
`tests/improve-measures.test.mjs`, "--report writes the page to .keel/keel.json
health". Its temporary Acme project had a `bash -n` child sleeping at 0% CPU
for over five minutes. A one-second stack sample showed `read` in every sampled
stack; stdin was a Unix socket. The existing syntax helper in
`practices/ci/files/scripts/keel/workflows.mjs` has no subprocess timeout.
The exact child was terminated after the sample was saved. The outer test and
gate then returned success (1589/1589), because the outer test checks reporting
rather than requiring the nested gate to succeed. This intervention means that
run is not evidence of an unattended green gate. Its log remains
`/tmp/keel-phase72/check-final.log`; the sample is
`/tmp/keel-phase72/stalled-bash.sample.txt`.

The precisely identified test was then run alone:
`node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='report writes the page to' tests/improve-measures.test.mjs`.
Exit 0, 1/1 passed, 5.294 seconds on this machine. This does not erase the hang
or prove its cause. An initial broader diagnostic of `tests/improve.test.mjs`
also passed 17/17, but that was not the affected file. The final integrated gate
is rerun after this recorded diagnosis; its result is in the commit body.

Follow-up: bound workflow syntax subprocesses and test the timeout/teardown path;
investigate file input rather than stdin before calling it a fix. No speculative
parser or timeout change is included in phase 72. The attempted GitHub issue
was rejected by automatic approval review pending explicit owner permission.
The local issue draft is `/tmp/keel-phase72/stall-issue.md`; this section preserves
the actionable report in the repository regardless of whether it is published.
