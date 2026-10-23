---
status: built
since: 2026-10-20
goal: G0
spec: 2
depends: [26, 87]
note: "Scoped decision context is implemented and checked through packed, adopted and workflow surfaces; live use remains."
evidence: ["evidence/2026-10-20-decision-context.md"]
---

# Builders receive the decisions that still apply

## Done when

A builder brief resolves explicitly linked decisions by scope at the source revision, carries their provenance, and refuses contradictory or unavailable required context before dispatch or resume.

## Scope

Implement slice 90 of [Decisions and feedback](../specs/decisions-and-feedback.md).
Keep the existing authorities and authorization boundaries.

## Acceptance

- [x] Scoped replacements keep unrelated choices and proposed successors replace nothing: `tests/decision-context.test.mjs`.
- [x] Cycles, overlapping accepted successors, missing anchors and exceeded read bounds are explicit gaps: `tests/decision-context.test.mjs`.
- [x] A stale source digest is refreshed before dispatch and resume; legacy targets with no references are explicitly not configured: `tests/decision-context.test.mjs`.
- [x] Conductor and robot briefs separate accepted choices from proposals and reports retain the digest used: `tests/decision-brief.test.mjs`.
- [x] The shipped guide, agent help and packed CLI expose the same read-only contract: `tests/decision-brief.test.mjs`.

## Real surfaces

- Published package: pack and extract the CLI, then exercise the slice in a disposable Acme repository without a plates checkout.
- Adopted project: render the affected practice into Acme and check its agent guide, JSON interface and failure cases.
- Owner's machine: repeat the local lifecycle in a fresh process, retaining state and checking refusal after a source change.
- Workflow shell: run the trusted robot context command in the workflow environment with a synthetic issue transport; assert the uploaded plan and builder brief share the refreshed digest before any agent step.

## Proof

The named tests exercise the implementation and its refusal paths. See the evidence for observed results and limits.

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

Observe an approved builder run using the emitted decision digest. Keep live use and deployment separate from the local implementation proof.

## Trajectory

2026-10-20: A bounded incoming-link inventory was needed to detect accepted successors whose predecessor omitted the reciprocal link. Scope resolution alone could not catch that contradiction. A packed walkthrough also exposed a parser bug: an anchor before the next heading could replace the preceding section’s anchor. The parser now carries that anchor forward. The robot workflow refreshes context before uploading its plan, so the saved plan and dispatched brief name the same digest.

2026-10-20: The integrated gate showed that adding reconciliation as a mandatory climb practice broke existing climb configurations. Climb now declares only the managed runtime scripts it imports. This preserves optional reconciliation workflows and keeps one source owner for the scripts.
