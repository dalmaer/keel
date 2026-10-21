# Evidence: phase 102 — bounded routine and attempt history

- Date: 2026-10-21
- Phase: [102](../phases/102-routines-have-a-complete-observed-history.md)
- Revision: `fd53553` plus the working tree for `phase 102: Routines have a complete observed history`.
- Claim: read-only fleet/project definitions and observed attempts preserve identities, coverage, private scope, stages, evidence and unknown costs. This is implementation proof, not hosted activation or owner acceptance.

## Automated checks

The conductor independently ran:

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-runs.test.mjs tests/web-run-coverage.test.mjs`: exit 0, 21/21 tests; `/tmp/keel-phase102-actions-conductor.log`.
- `node --import ./tests/helpers/hermetic.mjs --test tests/web-run-receipts.test.mjs tests/web-runs-ui.test.mjs`: exit 0, 28/28 tests; `/tmp/keel-phase102-private-ui-conductor.log`.
- `node /tmp/keel-phase102-receipts-sql-proof.mjs`: exit 0. Isolated PostgreSQL execution of migrations 004 and 007 checked role/direct-access denial, actor/project scoping, stable cursor pagination, byte limits, and unchanged expired prepared reservations and recovery. One connection, no hosted concurrency claim. Log: `/tmp/keel-phase102-sql-conductor.log`.
- `node /tmp/keel-phase102-review-cases.mjs --fixed`: exit 0. Literal triggers and schedules survive unrelated job expressions; three workflow IDs sharing a path cannot regain an arbitrary winner; old active attempts remain visible. The initial probe exposed all three failures; regressions were added before the passing run.
- `git diff --check`: exit 0 before the record.

Builders additionally reported focused receipt/operation/migration proof (48/48), and UI/auth/server/Home/events/docs/guides proof (56/56), all exit 0. These are builder results, not a substitute for the conductor checks or integrated gate. Earlier fixture errors and an authored-file byte-counter shadowing defect were corrected; no passing retry is treated as evidence of a flake.

`npm run typecheck` is the required fast check through `keel ready`. `npm run check` is the final integrated gate through `keel integrate`, covering all tests, pinned timing checks, roadmap, rendered files and inbox guards. These run after this record; their exact results belong in the subsequent integration record.

## Real GitHub surface

At 23:00:14 UTC, `node /tmp/keel-phase102-real-actions.mjs` exited 0. It exercised the actual read adapter using the owner's existing GitHub CLI credential in memory and compared its results with independent `gh api` reads. No workflow was dispatched and no credentials were printed or committed. The source was repository ID 1402587435, default branch `main`, revision `431ec5983ca7e837fa6734a3787c5a2bd59be118`.

- All twenty observed recent logical runs matched the independent provider page by numeric identity, status, conclusion and source revision.
- Attempt 1 of run 39683941272 matched success, job 119513111822 and retained artifact 12384209778.
- Attempt 1 of run 39680232760 matched skipped, with missing usage/evidence kept unknown.
- Attempt 1 of run 39675132151 matched failure and jobs 119482894676 / 119482986327.
- Estimated weighted minutes for the success and failure details were 5 and 1; actual charges remained null and acceptance not established. Artifact metadata remained logical-run scoped.
- Overview used 17 source calls / 846,994 bytes. Each detail used 18 source calls. Pagination, provider retention and conservative metadata extraction remained explicit gaps.

The retained scratch result is `/tmp/keel-phase102-real-actions.json`; its private credential basis does **not** establish the hosted App's Actions grant. Numeric endpoints `/repositories/1402587435/actions/runs`, `/actions/workflows`, `/actions/runs/<id>/attempts/1`, their jobs, and run artifacts all returned successfully. The official [runs](https://docs.github.com/en/rest/actions/workflow-runs), [jobs](https://docs.github.com/en/rest/actions/workflow-jobs) and [artifacts](https://docs.github.com/en/rest/actions/artifacts) references document owner/name routes; numeric transport is observed compatibility, not an official durability promise. No name fallback is implemented.

## Browser walk

`node /tmp/keel-phase102-browser-demo.mjs` served actual auth, routes and adapters composed with synthetic Acme network responses. Browser navigation started at `http://127.0.0.1:58402/demo/login`. No external writes occurred.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Open fleet Activity at desktop width | Thirteen deduplicated records; three visited and one explicitly unvisited project; coverage disclosure and separate source links | Bounded combined view, not complete provider history |
| Change lens to studio, select failed, apply filters | Two failed attempts retained; URL preserved `days=30&status=failed` | Native filter navigation and original failure preservation |
| Open attempt 2 | Preceding-attempt link, failed job/step, 61-second duration, two weighted-minute estimate, actual charges unknown | Detail composition and estimate labeling |
| Inspect retained evidence | Expired artifact explicitly unassigned to the attempt | Retention/provenance visibility, not recovered bytes |
| Open project Routines, then switch to fleet and next batch | Trigger/schedule/source shown; failed filter retained; fourth project's definition appeared only in batch 2 | Project/fleet lens and bounded continuation |
| Repeat detail/definition/batch navigation at 390px | `document.documentElement.scrollWidth === innerWidth === 390` in each checked view; controls and cards remained contained | Responsive browser proof, not a physical phone owner walk |
| Inspect private operation card | Uncertain state stayed unknown and linked its original receipt | History does not perform recovery; old uncertainty also has named adapter/route regression proof |

Screenshots: [desktop attempt](images/2026-10-21-routine-attempt-desktop.png), [mobile attempt](images/2026-10-21-routine-attempt-mobile.png), [mobile routines](images/2026-10-21-routines-mobile.png). Browser viewport was reset after verification. An initial label locator did not match; the accessible combobox role succeeded without a code change.

## Gaps and decision

Phase remains **partial / owes walk**. The production deployment has not changed. Required activation: approved GitHub App Actions-read, migration 007 after 004, and a deployment of the verified source. Migration 007 SHA-256: `0a55a4cf0898403acbdb6781e12ab43d9e69b62f4448d89ec45bd32d5d0ba616`. It adds a service-role-only read projection; no persistent run mirror or new table. Existing hosted migrations and credential prompts remain separate setup work.

The owner must compare one real routine and retry from phone and desktop, including failure/skip, stages, source evidence, unknown usage and unavailable coverage. No recent retry was found in the bounded real sample; synthetic retry proof does not replace this exercise. Local runner reporting, execution/retry/cancel controls and automatic model routing belong to later phases. No paid service, permission expansion or owner observation is inferred from these tests.

## First integration attempt

`node bin/keel.mjs ready --check 'npm run typecheck' --json` exited 0 on
`7b9933e9a66ff60ecb3f63cc40e5686239e1f9d0`; typecheck exit 0.
`node bin/keel.mjs integrate --json` then exited 1: one full gate,
2,232 tests / 2,230 passed / 2 failed, nothing pushed to main. Both failures
were existing evidence tests: the thirteen-command numeric-output fixture
exceeded its outer 15-second subprocess bound; the descendant-cleanup fixture
read a missing PID file after its one-second execution bound. Pinned stall
checks subsequently passed, including evidence tests. The ledger reported no
flaky/slower note and excluded its busy run from timing comparison. These facts
do not erase the failures. Logs: `/tmp/keel-phase102-integrate.{json,stderr}`.

The required isolated diagnosis command
`node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='strict numeric output and literal top-level JSON selection|parent exit and timeout clean ordinary descendants' tests/evidence.test.mjs`
exited 0, 2/2 tests. This establishes sensitivity to the full-run environment,
not a corrected gate. A bounded fixture repair is being verified before any
new integration attempt. No runtime evidence behavior is intentionally changed.

## Fixture repair verification

Only `tests/evidence.test.mjs` and its synthetic child helper changed. Parser
coverage now runs the real `rederive` adapter with executor timers held; separate
CLI and real-time deadline coverage remains. Cleanup waits for bounded real
fixture readiness, deliberately delays startup beyond one second, then checks
real descendant cleanup and the exact configured executor timeout. This removes
startup races without changing production timeout or cleanup behavior.

The conductor ran
`node --import ./tests/helpers/hermetic.mjs --test tests/evidence.test.mjs tests/docs.test.mjs tests/guides.test.mjs`:
exit 0, 35/35 tests. Log: `/tmp/keel-phase102-hygiene-conductor.log`.
`python3 /tmp/keel-phase102-evidence-probes-node26.py` exited 0 using the gate's
Node 26.12.0 executable in isolated copies. Broken numeric parsing, parent-only
cleanup and a doubled executor deadline each failed a meaningful assertion.
The original fixtures failed with delayed startup (`ENOENT`) and a deliberately
slowed parser batch (`ETIMEDOUT`); the corrected slowed batch passed. Exact
commands, isolated paths and results are in
`/tmp/keel-phase102-conductor-node26-evidence-probes.json`.
An earlier independent probe also passed on Node 24.21.0, selected by the default
shell; that older runtime is not production-minimum verification. The gate-version
probe was run explicitly to remove that ambiguity.

The setup guides now link optional media migration 006 and scoped read-only
history migration 007, with separate resource and permission activation. A fresh
integration gate is required after this verified fixture correction; the first
failed gate remains recorded above.

## Corrected integration result

On 2026-10-21, `node bin/keel.mjs ready --check 'npm run typecheck' --json`
exited 0 on `7194754deaebeb3ff7cee064da8000994323f506`; typecheck exited 0.
`node bin/keel.mjs integrate --json` exited 0: one corrected full gate,
2,232/2,232 tests, all eight pinned timing suites and roadmap/render/inbox guards
passed. The ledger found no flaky or slower tests and omitted its busy run from
timing comparisons. It pushed `fda59e68a1d9d99f27f919c727076d1087b0758f`
to main. The initial failed gate remains part of the evidence, not a passing retry.
Logs: `/tmp/keel-phase102-corrected-integrate.{json,stderr}`.

The phase102 claim was released after integration. CI typecheck run39693926499
succeeded on that exact main revision; check run39693926523 was still running
at this observation. No production deployment or owner acceptance is implied.
