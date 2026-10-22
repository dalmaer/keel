---
status: partial
since: 2026-10-21
goal: G7
spec: 2
depends: [103, 104]
note: "Local routing, accounting, checkpoint and desktop/mobile proofs pass; hosted admission and approved provider/owner walk remain."
owes: walk
evidence: ["evidence/2026-10-21-web-model-routing.md"]
---

# Model routing respects capacity and policy

## Done when

Each run selects an eligible model under an explicit capacity and budget policy, explains the choice and preserves task and review requirements during fallback or handoff.

## Scope

Add opt-in task-class preferences, approved fallbacks, capability/privacy filters, freshness rules, reserve thresholds, shared reservations and cooldown. Pin a model per attempt; checkpoint handoff must retain ownership, side effects and actual cost.

Contract: [Model choice and checkpoints](../specs/web-model-routing.md),
[Fleet operations](../specs/web-fleet-operations.md),
[workspace](../specs/web-workspace.md) and [CLI mapping](../specs/web-ui-command-map.md).

## Acceptance

- [x] Unknown capacity, low quota, shared-pool races, independent review and provider restrictions produce a valid selection or an explained wait: `tests/web-model-routing.test.mjs`.
- [x] A checkpoint handoff preserves decisions and revision, reconciles uncertain effects and never silently upgrades spend or restarts completed work: `tests/web-model-handoff.test.mjs`.
- [ ] ⚑ By hand: owner completes the real-surface exercise below: `docs/specs/web-fleet-operations.md`.

## Real surfaces

- Owner's machine: verify policy explanations against supported live provider observations and one bounded approved run or handoff.

## Proof

Named local tests are implemented. Hosted independent-connection contention and
the real provider exercise remain separate proof in the evidence record.

- `node --import ./tests/helpers/hermetic.mjs --test tests/web-model-routing.test.mjs tests/web-model-handoff.test.mjs`
- `npm run check`
- `npm run typecheck`
- Perform the real-surface exercise; record source revisions, exact commands,
  timestamps, scope, actual outcomes and unavailable coverage in dated evidence.

## Deliberately open

Settled 2026-10-21 by existing-adapter and official API review: begin with a tool-free two-stage evidence planning adapter. Unknown capacity defaults to wait; explicitly budgeted API use is a separate opt-in. No model, price, quota pool or paid fallback is assumed. Supported task classes and local subscription execution remain explicit capability limitations; see the model-routing contract.

## Next action

Obtain approval for migration 011 and hosted independent-connection proof, then the
selected provider credential, exact source/retention policy and small monetary
allowance. Verify one real bounded run and saved-summary continuation. No live
model call, migration or production activation is established by the local proof.

## Trajectory

- **2026-10-21** — Owner expanded G7 from the first private decision workspace to operating all authorized projects through the web on mobile and desktop.

- **2026-10-21** — Existing connection probes have no usable inference capacity and existing workers cannot run models. A bounded planning adapter supplies a real operation; unsupported builds/review and subscription reporting remain visible limitations rather than fabricated eligibility. See the model-routing contract.

- **2026-10-21** — Credential rotation must be checked at the database send grant;
  a preceding credential read leaves a race. Unknown delivery also blocks its
  connection across projects when recording a throttle is uncertain. Local SQL
  and transport proofs cover these boundaries; hosted contention remains open.

- **2026-10-21** — Decision-context inventory reads are broader than required
  linked records. Retain the complete context digest but export only explicitly
  selected linked records; unsupported decision paths refuse. An unrelated phase
  or design inventory entry no longer makes a valid packet impossible.

## Your part

- **Ask:** Review and enable a bounded routing policy, then explain a real model choice and verify a supported fallback without widening budget or provider access.
- **Why:** Fixtures cannot establish real access, source completeness or operating usefulness.
- **Look at:** [Fleet operating contract](../specs/web-fleet-operations.md) and this phase's dated evidence.
- **Choices:** Verified | Needs changes | Cannot check yet
- **Keeps it open:** Needs changes | Cannot check yet
- **Takes:** One setup or operating session; record actual duration and cost.
- **Then:** Record observed outcomes, keep gaps open and name the next action.
- **Ready when:** Automated proof passes and the approved service exposes this phase's feature.
