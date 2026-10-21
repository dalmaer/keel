---
status: planned
since: 2026-10-21
goal: G7
spec: 2
depends: [103, 104]
note: "Expanded fleet operating goal; design and proof remain to be implemented."
evidence: []
---

# Model routing respects capacity and policy

## Done when

Each run selects an eligible model under an explicit capacity and budget policy, explains the choice and preserves task and review requirements during fallback or handoff.

## Scope

Add opt-in task-class preferences, approved fallbacks, capability/privacy filters, freshness rules, reserve thresholds, shared reservations and cooldown. Pin a model per attempt; checkpoint handoff must retain ownership, side effects and actual cost.

Contract: [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Unknown capacity, low quota, shared-pool races, independent review and provider restrictions produce a valid selection or an explained wait: `tests/web-model-routing.test.mjs`.
- [ ] A checkpoint handoff preserves decisions and revision, reconciles uncertain effects and never silently upgrades spend or restarts completed work: `tests/web-model-handoff.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Owner's machine: verify policy explanations against supported live provider observations and one bounded approved run or handoff.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-model-routing.test.mjs tests/web-model-handoff.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Thresholds, reservation estimates, unknown-usage settlement and safe checkpoint support depend on verified adapters; no paid fallback is enabled by default.

## Next action

Specify deterministic selection and reservation rules with denial cases before integrating provider dispatch.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

## Your part

- **Ask:** Review and enable a bounded routing policy, then explain a real model choice and verify a supported fallback without widening budget or provider access.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
