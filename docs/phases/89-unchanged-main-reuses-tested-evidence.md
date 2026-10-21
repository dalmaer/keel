---
status: built
since: 2026-10-17
goal: G4
spec: 1
depends: [79]
note: "Implemented with 20 focused and 1,860 integrated tests passing; Plates opts in. Fresh-data work continues."
evidence: ["evidence/89-unchanged-main-reuses-tested-evidence.md"]
---

# Unchanged main reuses tested evidence

## Done when

An opted-in project reuses successful exact-revision CI gate evidence beyond 24 hours while changed, dirty, failed or unavailable evidence still causes a real gate and time-dependent night work continues.

## Scope

Extend the existing night gate reader described in [the night guide](../guide/the-night-shift.md), “One gate result per commit.” No separate cache, schedule or model budget.

## Acceptance

- [x] `ci.gateReuse: "until-change"` removes only the age limit; omitted or `"24-hours"` preserves existing behavior.
- [x] Invalid policy values are rejected; artifacts, command, tree, latest attempt and source checks remain mandatory.
- [x] Tests prove an old successful result skips execution and changed/missing/failed evidence does not.
- [x] Plates opts in; guide and shipped scripts agree. No entire-night skip or new tracking store.

## Proof

`node --import ./tests/helpers/hermetic.mjs --test tests/gate-reuse.test.mjs`; `npm run check`; `npm run typecheck`.

## Deliberately open

Expired or deleted GitHub artifacts force a new gate. Reuse does not prove current external services, dependency advisories or production health.

## Next action

Observe the next unchanged-main night reuse its GitHub test evidence; other repositories may opt in after updating the night practice.

## Trajectory

2026-10-17: the existing CI artifact already owns tested SHA, tree and command evidence. Extend its age policy instead of introducing a second last-tested marker.
