---
status: designed
since: 2026-10-21
goal: G7
spec: 2
depends: [95]
note: "Provider capability matrix and scoped encrypted-vault contract selected; implementation and live activation remain."
evidence: []
---

# Connections expose scoped model capacity

## Done when

The owner can configure scoped provider credentials and inspect supported account/model capacity with source freshness, shared-pool identity and explicit unsupported coverage.

## Scope

Design and verify provider/auth support before implementing write-only key setup, validation, rotation/revocation and connection health. Store only secret references in private Git. Keep subscription windows, API limits, spend budgets and runner capacity distinct.

Contract: [Connections and capacity](../specs/web-connections.md), [Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [ ] Secret setup, revocation and project scoping deny unauthorized use and never leak values through logs, exports or browser storage: `tests/web-connections.test.mjs`.
- [ ] Shared pools are deduplicated, units remain distinct, and stale, unsupported or malformed reads never imply available quota: `tests/web-capacity.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Owner's machine: verify approved provider connections, secret-store injection and supported quota reads without exposing credentials.

## Proof

Test paths below are planned implementation targets, not existing passing checks.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-connections.test.mjs tests/web-capacity.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Settled 2026-10-21 by documented capability discovery: initial fixed-endpoint
OpenAI and Anthropic API-key metadata validation, private Git policy, separate
encrypted runtime vault and deployment wrapping key. See the dated matrix.
Live provider/key proof, optional vault activation and hosted permission changes
remain open. Local subscription reporting requires a later authenticated worker;
no universal quota endpoint is assumed.

## Next action

Implement the scoped policy, vault, capacity normalization and desktop/mobile
Connections routes against the agreed contract. Keep credential forms disabled
until the selected adapter and secret-store binding have live proof.

## Trajectory

- **2026-10-21** — Metadata access does not establish inference capacity. The selected APIs and local subscription readers expose different scopes; the web keeps unsupported coverage explicit and requires a separate authenticated local reporter before using subscription observations.

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

## Your part

- **Ask:** Connect approved provider accounts and compare the capacity screen with authoritative observations, including one unavailable scope.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
