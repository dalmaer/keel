---
status: planned
since: 2026-10-20
goal: G0
spec: 2
depends: [26, 87]
note: "Authorized specification; implementation and real-use evidence remain."
evidence: []
---

# Builders receive the decisions that still apply

## Done when

A builder brief resolves explicitly linked decisions by scope at the source revision, carries their provenance, and refuses contradictory or unavailable required context before dispatch or resume.

## Scope

Implement slice 90 of [Decisions and feedback](../specs/decisions-and-feedback.md).
Keep the existing authorities and authorization boundaries.

## Acceptance

- [ ] Scoped replacements keep unrelated choices and proposed successors replace nothing: `tests/decision-context.test.mjs`.
- [ ] Cycles, overlapping accepted successors, missing anchors and exceeded read bounds are explicit gaps: `tests/decision-context.test.mjs`.
- [ ] A stale source digest is refreshed before dispatch and resume; legacy targets with no references are explicitly not configured: `tests/decision-context.test.mjs`.
- [ ] Conductor and robot briefs separate accepted choices from proposals and reports retain the digest used: `tests/decision-brief.test.mjs`.
- [ ] The shipped guide, agent help and packed CLI expose the same read-only contract: `tests/decision-brief.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then exercise the slice in a disposable Acme repository without a keel checkout.
- Adopted project: render the affected practice into Acme and check its agent guide, JSON interface and failure cases.
- Owner's machine: repeat the local lifecycle in a fresh process, retaining state and checking refusal after a source change.

## Proof

These are implementation targets, not tests already present or results of this
specification task. Add the named tests before claiming acceptance.

- `node --import ./tests/helpers/hermetic.mjs --test tests/decision-context.test.mjs tests/decision-brief.test.mjs`
- `npm run check`
- `npm run typecheck`
- `npm pack --ignore-scripts --pack-destination /tmp` followed by the disposable Acme lifecycle above. Record the extracted package revision, exact commands and outputs in this phase's evidence when implemented.

No live writes or paid sessions are required for the automated proof. A later
live walk must name its approved destination and actual costs in evidence;
local success is not a claim of deployed or lived-in behavior.

## Deliberately open

Owner attribution in a source record is recorded evidence, not cryptographic identity. Conflicting owner instructions need an explicit source correction. Running agents are revalidated at safe boundaries, not forcibly interrupted.

## Next action

Implement the shared decision resolver using the existing reconciliation parser, beginning with scoped supersession fixtures.
