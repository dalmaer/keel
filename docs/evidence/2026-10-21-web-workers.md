# Evidence: durable web workers

- Date: 2026-10-21 local; browser walkthrough approximately 2026-10-22 00:28–00:33 UTC.
- Phase: [104](../phases/104-web-operations-run-through-durable-workers.md).
- Revision: design `efb86e2e09b4c73934d90872c3276d9b3218ed8b` plus working tree for **phase 104: Web operations run through durable workers**.
- Claim: authenticated run previews, durable admission, fixed workers, conservative recovery, cancellation, linked retries and narrowly supported existing schedule edits work locally. Hosted activation and owner acceptance remain open.
- Decision context: `not-configured`, digest `b770dcdf9c59944c5fc25a732e495e3ca697b1ea31d0bbc6be6e0b5234468500`; accepted choices, proposals and gaps empty. This preserves legacy behavior, not verified architecture coverage. Claim 104 revalidated mine/here before the browser correction resume.

## Automated checks

The conductor independently ran:

```sh
node --import ./tests/helpers/hermetic.mjs --test tests/web-jobs.test.mjs tests/web-routine-actions.test.mjs
# initial exit 0; 23/23
node --import ./tests/helpers/hermetic.mjs --test tests/web-worker.test.mjs tests/web-worker-oidc.test.mjs
# exit 0; 22/22
node --import ./tests/helpers/hermetic.mjs --test tests/web-jobs-ui.test.mjs
# initial exit 0; 22/22
node --import ./tests/helpers/hermetic.mjs --test tests/web-jobs.test.mjs tests/web-routine-actions.test.mjs tests/web-jobs-ui.test.mjs
# after review/browser corrections: exit 0; 48/48 (25 backend, 23 UI)
node /tmp/keel-phase104-conductor-sql-null.mjs
# meaningful pre-fix exit 1; corrected exit 0
node /tmp/keel-phase104-conductor-sql-proof.mjs
# first exit 1 at null worker result; corrected exit 0
```

Scratch SQL probes are supplementary session artifacts, not installed commands.
The SQL was executed in isolated PGlite after migration 001, without optional
vault migration 008. It verified anonymous/authenticated RPC denial, service
direct-table denial, RLS, scoped reads, duplicate intent, project lanes,
workspace/project budgets, one dispatch, same-process claim recovery with the
original fence/deadline/lease, one begin, sequence checks, null inputs and nested
results, terminal-only lane release, completion-based seven-day charges, older
unresolved charges, pre-dispatch cancellation release and one cancellation POST
grant. One connection does not establish hosted independent-connection races.
Migration 009 SHA-256:
`8c0c5bb1e4f61e719870181c40536cbfe5adbbe8681b1e6e45be752b8e55ceec`.

Tests use actual service, authentication, registry, provider/store adapters,
OIDC signatures and browser client with synthetic Acme external transports.
Worker tests launch actual subprocesses, verify a real temporary Git checkout,
and check that child/descendant processes stop after lost authorization,
cancellation, deadline and parent exit. Fixed test executables stand in for npm;
this is not the real Actions workflow shell exercise.

Additional coverage includes returned run identity pinning, competing claims,
ambiguous/incomplete provider scans, stale source and grants, exact workflow and
worker blob pins, setup-inclusive deadlines, original-session revocation without
idle renewal, cross-project denial, impossible external grants, final buffered-read
authorization, source schedule conflicts and lost conditional-commit recovery.

Builder focused checks: backend 25/25 with spec and ledger reporters, exit 0,
no flaky/slower findings; UI plus existing auth/access/server/routine/docs checks
62/62 before its last regression, exit 0, then UI 23/23 after it; worker 22/22,
exit 0; existing contributor typecheck workflow guard 1/1, exit 0. The guide's
synthetic disabled registry passed the actual validator. No builder ran the full gate.

The integrated tree will run `npm run typecheck` through
`node bin/keel.mjs ready --check "npm run typecheck" --json`, then
`npm run check` through `node bin/keel.mjs integrate --json`. The latter covers
the complete test suite and roadmap/render/inbox guards. Committed results are
recorded after integration, not presumed here.

## Review findings

- The draft SQL accepted a provider object containing only `state: completed`,
  incorrectly terminating a reservation. Independent rejection assertion failed
  before correction. A wider probe then found `result.state: null` accepted;
  both corrected assertions and the complete matrix passed. SQL NULL and JSON
  null are handled explicitly instead of relying on nullable comparisons.
- A signed immutable GitHub subject regression failed before the verifier added
  the documented immutable-ID default alongside the legacy default. Exact
  repository/owner IDs and names/ref remain bound; custom subject templates refuse.
- Review aligned the worker/store fence type, required current Actions-write
  immediately before cancellation, validated nested external rows, and rejected
  impossible `begin` grant/state combinations. The impossible grant regression
  failed in an isolated baseline and passed after only production modules changed.
- The browser found that terminal projection changed an already running worker
  to `unclaimed`. An isolated regression failed, then passed with
  `result-unavailable` when a claim exists but no final worker result does.
- Starting a retry left two active receipts; old controls invoked the new request.
  The regression failed with two controls, then passed with one stable active
  receipt and a preceding-request link. The conductor rewalked the final client.
- Tooling-only failures: the first screenshot save referenced an undefined scratch
  filesystem binding; importing it saved the already captured image. `keel` was
  absent from PATH during resume checks, so the repository entrypoint was used.
  Neither failure was treated as product proof.

## Browser exercise

`node /tmp/keel-phase104-browser-demo.mjs` listened only on
`http://127.0.0.1:58404`. It asserted a complete supported routine registration
and matching catalogue before each dispatch/schedule mode. Actual authenticated
routes and signed synthetic OIDC were used; GitHub/SQL transport was synthetic.
No real provider write or repository command ran. The demo was restarted after
the two browser corrections, then stopped; its tab closed and viewport reset.

| Did | Observed | Proves / does not prove |
| --- | --- | --- |
| Open catalogue, review source and 15-minute reservation, approve synthetic run | Original receipt URL installed before submission; saved run 9001 linked | Actual local browser/service journey, not hosted execution |
| Reload, send signed claim and begin | Same original receipt progressed from waiting to claimed/running with bounded deadline | Worker protocol integration, not real Actions execution |
| Request cancellation and then supply terminal provider observation | Cancellation remained pending until explicit reconciliation; only then retry appeared | Intent and termination stay separate |
| Review/start linked retry | Final client showed one check control, one cancel control and one preceding link; explicit check preserved new identity | Corrected control/receipt binding after retry |
| Terminate a claimed worker without its final report | Final projection showed provider success and worker `result-unavailable` | No invented worker result or erased claim |
| Lose dispatch response, reload on mobile, check original operation | Uncertain original identity recovered run 9001; no new start form | Reconnect recovery; backend tests assert one POST |
| Review cron `23 7 * * *` to `24 7 * * *`, approve and reload | Exact source preview, separate bounds, verified synthetic commit receipt | Conditional cron source journey; no actual schedule fired |
| Disable execution, then make store unavailable | Inspection remained available without start; project error and fleet coverage gap exposed missing store | Unavailable evidence is not zero work |
| Normal 1280 viewport and 390×844 viewport | Document width matched viewport; controls and source/request text remained usable | Responsive browser emulation, not physical-device or complete accessibility acceptance |

Screenshots contain synthetic records only:

- [Desktop run preview](images/2026-10-21-jobs-preview-desktop.png).
- [Mobile running receipt](images/2026-10-21-jobs-running-mobile.png).
- [Mobile uncertain dispatch after reload](images/2026-10-21-jobs-recovery-mobile.png).
- [Desktop schedule review](images/2026-10-21-jobs-schedule-desktop.png).
- [Desktop verified schedule receipt](images/2026-10-21-jobs-schedule-receipt-desktop.png).
- [Desktop corrected linked retry](images/2026-10-21-jobs-retry-desktop.png).

A separate read-only call,
`gh api repos/dalmaer/keel/actions/runs/39697083371/attempts/1/jobs`, confirmed
the existing CI job returns `run_attempt: 1` and the expected source SHA.
It did not dispatch anything or establish the new worker surface.

## Gaps and decision

Status: **partial, owes walk**. Production still serves the previously recorded
phase 96 deployment. No migration 009, worker App permission, private registry,
callback variable, runtime budget, real dispatch or real schedule edit was activated.
Job receipts intentionally leave measured runtime and financial cost unavailable;
the original provider attempt remains linked. No provider credential injection,
arbitrary shell, new scheduler or model spend is implied.

After explicit approval, the owner/operator exercise must:

1. Verify migration 009 with independent hosted connections, client-role denial,
   atomic budget/lane conflicts and rollback; record restore reconciliation before
   enabling effects. An empty restored table is not unused-budget proof.
2. Bind selected Actions-write access, exact numeric identities and worker blobs,
   the fixed callback origin and approved minutes; verify the serving runtime and
   source revision. Keep provider credentials outside the worker.
3. Dispatch one bounded real typecheck, reconnect, inspect its original run and
   duplicate request behavior, request cancellation and separately review a retry.
   Record run/attempt/job IDs, deadlines, actual outcomes and cost or unavailable cost.
4. Separately review an approved existing project-owned schedule, preserving every
   unrelated byte and observing its source timeout/overlap/cadence behavior. This
   repo's no-cron typecheck cannot establish that surface.
5. Complete those journeys on the owner's desktop and phone and record usability
   findings. A local pass or merge does not establish production or lived-in use.

## Integration correction, 2026-10-21 local

The first integrated test suite on implementation `514305eff946472de3eccdb17c51f3d078077dbb`
reported 2,363 tests: 2,361 passed and two failed. Both failures were the same
phase-record defect: `Existing scheduled workflow` was not an allowed Real
surfaces category. The CLI JSON contract and self-doctor tests correctly rejected
that record. The surface now uses `GitHub API`, retaining the same existing-cron
exercise and acceptance requirement. No test assertion was weakened.

After the correction, the conductor ran:

```sh
node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='--json parses for every verb|keel itself is clean' tests/cli.test.mjs tests/doctor.test.mjs
# exit 0; 2/2
npm run roadmap
# exit 0; 109 phases, 8 goals
```

The corrected doctor read reports no lint and no edited/both managed-file drift.
The failed integrated result remains part of this record; the next integration
attempt must check the corrected tree in full.


## Corrected integration, 2026-10-21 local

`node bin/keel.mjs ready --check "npm run typecheck" --json` exited 0 for
`bdc71c5f9a945fdee4f889a811d554f6b4513433`; type checking exited 0.
`node bin/keel.mjs integrate --json` then exited 0, one full gate, and pushed
main `7c3161db38cdd5c67a1afa6b6781c1974b6b76c4`.
The corrected suite passed 2,363/2,363 tests. All eight configured stall checks
passed; the ledger reported no flaky or slower tests, with the busy run excluded
from timing comparisons. Roadmap, render (89 targets: 9 kept, 80 same), inbox
and pattern guards passed. Claim104 was released after integration.

This is integrated local proof. Exact-main GitHub check
[39702075753](https://github.com/dalmaer/keel/actions/runs/39702075753) and
typecheck [39702075767](https://github.com/dalmaer/keel/actions/runs/39702075767)
both completed successfully. The typecheck workflow correctly skipped its
web-worker job on this ordinary push; no web job was dispatched. Production still serves phase96; hosted SQL009,
Actions-write, the runtime allowance, worker activation and real owner exercise
remain unverified. A separate three-run bounded trial was proposed, not assumed
approved. No schedule writes or provider/model calls were included in that ask.
