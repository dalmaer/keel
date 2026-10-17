# Phase 89 evidence — 2026-10-17

The existing CI artifact remains authoritative for tested commit, tree, command,
run and attempt. `ci.gateReuse: "until-change"` removes the 24-hour age cutoff
only. Keel opts in; other repositories retain the default. This does not skip
scheduled collection, external health checks, or the whole night.

## Focused proof

`node --import ./tests/helpers/hermetic.mjs --test tests/gate-reuse.test.mjs`
uses synthetic GitHub records and real temporary repositories/command markers.
It covers old-success reuse without execution, default expiration, invalid policy,
explicit ancestry overrides, missing/expired/malformed artifacts, failed tests,
command/tree/source mismatch, dirty/changed code and latest pending attempts.
The real night's measure entry point is included. No actual old CI run is claimed.

The first conductor run failed one new fixture assertion: its pending-attempt
fixture duplicated a logical run ID, so the reader correctly reported incomplete
history before checking completion. The fixture now represents a newer distinct
run; the guard was not weakened. Builder focused proof: 20 passed, 0 failed.
Conductor final focused proof and full integrated gate results are recorded below.

## Limitations

GitHub artifact retention still bounds available proof. Missing or expired evidence
runs the gate. Tests depending on time or mutable external systems should retain
`24-hours`; production/Loop collection and other fresh-data work are not bypassed.
A reused gate is historical evidence, never a new local test execution or acceptance.

## Conductor verification

2026-10-17: final focused command exited 0: 20 passed, zero failed,
16,579.626 ms. `npm run check` exited 0: 1,860 tests passed, zero failed,
177,401.470 ms for the plain suite; configured stall probes and roadmap/render/
inbox guards passed. Hygiene reported no flaky or slower test.
`npm run typecheck` exited 0. No operational unchanged-main night is claimed yet.
